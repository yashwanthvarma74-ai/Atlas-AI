import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHashEmbedder, EmbeddingError, type Embedder } from './embeddings';
import { requeueStale, startIngestWorker, uploadDocument, type IngestWorker } from './index';
import type { WorkspaceAccess } from './access';
import { createTestCore, type TestCore } from './test/context';

const text = Array.from({ length: 30 }, (_, i) => `Sentence ${i} about revenue.`).join(' ');
const bytes = new TextEncoder().encode(text);

// Polls until the document reaches one of the given statuses, so the tests wait for the worker instead
// of sleeping for a guess.
async function until(core: TestCore, id: string, statuses: string[], timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const doc = await core.database.documents.findOne({ _id: new ObjectId(id) });
    if (doc && statuses.includes(doc.status)) return doc;
    if (Date.now() > deadline) throw new Error(`Still ${doc?.status} after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('ingest worker', () => {
  let core: TestCore;
  let ws: WorkspaceAccess;
  let worker: IngestWorker | undefined;
  // swapped per test, so one core can show a recovering service and a broken one
  let embedder: Embedder = createHashEmbedder(256);

  beforeAll(async () => {
    core = await createTestCore(
      {},
      { embedder: { ...createHashEmbedder(256), embed: (texts) => embedder.embed(texts) } },
    );
    ws = await core.workspace(await core.user('owner@worker.test'));
  });
  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
    embedder = createHashEmbedder(256);
  });
  afterAll(() => core.destroy());

  it('takes an upload from queued to indexed on its own', async () => {
    worker = startIngestWorker(core);
    const doc = await uploadDocument(core, ws, { name: 'e2e.txt', bytes });

    const done = await until(core, doc.id, ['indexed', 'failed']);
    expect(done.status).toBe('indexed');
    expect(done.chunkCount).toBeGreaterThan(0);
  });

  it('retries a temporary failure and then succeeds', async () => {
    let calls = 0;
    const real = createHashEmbedder(256);
    embedder = {
      ...real,
      embed: async (texts) => {
        if (++calls === 1) throw new EmbeddingError('temporarily unreachable', true);
        return real.embed(texts);
      },
    };
    worker = startIngestWorker(core);
    const doc = await uploadDocument(core, ws, { name: 'flaky.txt', bytes });

    expect((await until(core, doc.id, ['indexed', 'failed'])).status).toBe('indexed');
    expect(calls).toBe(2);
  });

  it('gives up after three attempts, tells the user, and keeps the job as a dead letter', async () => {
    let calls = 0;
    embedder = {
      ...createHashEmbedder(256),
      embed: async () => {
        calls++;
        throw new EmbeddingError('down', true);
      },
    };
    worker = startIngestWorker(core);
    const doc = await uploadDocument(core, ws, { name: 'down.txt', bytes });

    const failed = await until(core, doc.id, ['failed']);
    expect(failed.error).toMatch(/kept refusing requests/);
    expect(calls).toBe(3);
    const job = await core.queues.ingest.getJob(doc.id);
    expect(await job?.getState()).toBe('failed');
  });

  it('does not retry a problem that retrying cannot fix', async () => {
    let calls = 0;
    embedder = {
      ...createHashEmbedder(256),
      embed: async () => {
        calls++;
        throw new EmbeddingError('bad key', false);
      },
    };
    worker = startIngestWorker(core);
    const doc = await uploadDocument(core, ws, { name: 'rejected.txt', bytes });

    await until(core, doc.id, ['failed']);
    expect(calls).toBe(1);
  });

  it('runs a document again after the user retries it', async () => {
    embedder = {
      ...createHashEmbedder(256),
      embed: async () => {
        throw new EmbeddingError('bad key', false);
      },
    };
    worker = startIngestWorker(core);
    const { retryDocument } = await import('./documents');
    const doc = await uploadDocument(core, ws, { name: 'again.txt', bytes });
    await until(core, doc.id, ['failed']);

    embedder = createHashEmbedder(256);
    await retryDocument(core, ws, new ObjectId(doc.id));
    expect((await until(core, doc.id, ['indexed'])).status).toBe('indexed');
  });
});

describe('requeueStale', () => {
  it('queues a document whose job was lost, and leaves recent ones alone', async () => {
    const core = await createTestCore();
    try {
      const ws = await core.workspace(await core.user('owner@stale.test'));
      const lost = await uploadDocument(core, ws, { name: 'lost.txt', bytes });
      const fresh = await uploadDocument(core, ws, { name: 'fresh.txt', bytes });
      await core.queues.ingest.remove(lost.id);
      await core.queues.ingest.remove(fresh.id);
      await core.database.documents.updateOne(
        { _id: new ObjectId(lost.id) },
        { $set: { updatedAt: new Date(Date.now() - 10 * 60_000) } },
      );

      expect(await requeueStale(core)).toBe(1);
      expect(await core.queues.ingest.getJob(lost.id)).toBeDefined();
      expect(await core.queues.ingest.getJob(fresh.id)).toBeUndefined();
      // running it again is harmless: queueing is idempotent per document
      expect(await requeueStale(core)).toBe(1);
      expect((await core.queues.ingest.getJobCounts('waiting')).waiting).toBe(1);
    } finally {
      await core.destroy();
    }
  });
});
