import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHashEmbedder, type Embedder } from './embeddings';
import { addMember, retrieve, type WorkspaceAccess } from './index';
import {
  createSearchTestCore,
  eventually,
  indexText,
  waitForIndexes,
  SEARCH_TEST_URL,
} from './test/search';
import type { TestCore } from './test/context';

// A stand-in embedder that knows nothing: every text gets the same vector. Vector search then has no
// signal at all, so whatever a test finds, it found by keyword.
const blind: Embedder = {
  ...createHashEmbedder(256),
  embed: async (texts) => texts.map(() => Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0))),
};

describe.skipIf(!SEARCH_TEST_URL)('retrieve', () => {
  let core: TestCore;
  let ws: WorkspaceAccess;
  const ids: Record<string, ObjectId> = {};

  beforeAll(async () => {
    core = await createSearchTestCore();
    ws = await core.workspace(await core.user('owner@retrieve.test'));
    ids.finance = await indexText(
      core,
      ws,
      'finance.txt',
      'Revenue grew 14 percent in the third quarter, driven by new regions in Asia.',
    );
    ids.ops = await indexText(
      core,
      ws,
      'ops.txt',
      'The warehouse consolidation reduced operating costs by six percent last year.',
    );
    ids.billing = await indexText(
      core,
      ws,
      'billing.txt',
      'Invoice INV-20931 is overdue and has been escalated to the finance team.',
    );
    await waitForIndexes(core, ws);
  }, 60_000);
  afterAll(() => core.destroy());

  it('puts the passage about the question first', async () => {
    const sources = await retrieve(core, ws, 'how much did revenue grow in the third quarter?');
    expect(sources[0]).toMatchObject({ documentName: 'finance.txt', page: 1, n: 1 });
    expect(sources[0]?.text).toContain('Revenue grew 14 percent');
  });

  it('numbers the sources S1, S2, ... in rank order, with no gaps', async () => {
    const sources = await retrieve(core, ws, 'percent');
    expect(sources.length).toBeGreaterThan(1);
    expect(sources.map((s) => s.n)).toEqual(sources.map((_, i) => i + 1));
    for (let i = 1; i < sources.length; i++) {
      expect(sources[i - 1]!.score).toBeGreaterThanOrEqual(sources[i]!.score);
    }
  });

  it('returns each passage once, even when both searches find it', async () => {
    const sources = await retrieve(core, ws, 'warehouse consolidation operating costs');
    const chunkIds = sources.map((s) => s.chunkId);
    expect(new Set(chunkIds).size).toBe(chunkIds.length);
  });

  it('respects the limit', async () => {
    expect(await retrieve(core, ws, 'percent', { limit: 1 })).toHaveLength(1);
  });

  it('can be narrowed to some documents, and never beyond the workspace', async () => {
    const onlyOps = await retrieve(core, ws, 'percent', { documentIds: [ids.ops!] });
    expect(onlyOps.map((s) => s.documentName)).toEqual(['ops.txt']);

    const stranger = await retrieve(core, ws, 'percent', { documentIds: [new ObjectId()] });
    expect(stranger).toEqual([]);
  });

  it('finds an exact code by keyword even when the embedding carries no signal', async () => {
    const blindCore = { ...core, embedder: blind };
    const sources = await retrieve(blindCore, ws, 'what is the status of INV-20931?');
    expect(sources[0]).toMatchObject({ documentName: 'billing.txt' });
  });

  it('finds a passage by meaning when it shares no word with the question', async () => {
    // A stand-in that gives synonyms the same direction, as a real embedding model does. The question
    // and the passage have no word in common, so keyword search finds nothing and the vector side
    // must carry it.
    const topics = [
      ['car', 'automobile', 'vehicle'],
      ['loan', 'mortgage', 'credit'],
    ];
    const semantic: Embedder = {
      ...createHashEmbedder(256),
      embed: async (texts) =>
        texts.map((text) => {
          const vector = new Array<number>(256).fill(0.01);
          topics.forEach((words, i) => {
            if (words.some((word) => text.toLowerCase().includes(word))) vector[i] = 1;
          });
          return vector;
        }),
    };
    const semanticCore = { ...core, embedder: semantic };
    await indexText(semanticCore, ws, 'garage.txt', 'The automobile was repaired on Friday.');
    await indexText(semanticCore, ws, 'bank.txt', 'The mortgage was approved on Monday.');
    await eventually(async () => {
      const sources = await retrieve(semanticCore, ws, 'when was my car fixed');
      expect(sources[0]?.documentName).toBe('garage.txt');
    });

    const sources = await retrieve(semanticCore, ws, 'when was my car fixed');
    expect(sources[0]?.text).not.toMatch(/\bcar\b/);
  });

  it('answers a question with no words in it with nothing, not an error', async () => {
    expect(await retrieve(core, ws, '???')).toEqual([]);
    expect(await retrieve(core, ws, '   ')).toEqual([]);
  });

  it('refuses, saying why, on a database with no Atlas Search', async () => {
    const plain = { ...core, searchAvailable: false, recheckSearch: async () => false };
    await expect(retrieve(plain, ws, 'anything')).rejects.toMatchObject({ status: 503 });
  });

  it('reranks by term coverage when asked to', async () => {
    const coverage = { ...core, config: { ...core.config, RERANKER: 'coverage' as const } };
    const sources = await retrieve(coverage, ws, 'third quarter revenue Asia');
    expect(sources[0]?.documentName).toBe('finance.txt');
  });

  it('stops returning a document as soon as it is deleted', async () => {
    const gone = await indexText(core, ws, 'temp.txt', 'The zeppelin hangar opens on Tuesday.');
    await waitForIndexes(core, ws);

    const { deleteDocument } = await import('./documents');
    await deleteDocument(core, ws, gone);

    await eventually(async () => {
      const sources = await retrieve(core, ws, 'zeppelin hangar');
      expect(sources.map((s) => s.documentName)).not.toContain('temp.txt');
    });
  });

  it('answers a member who was added later exactly as it answers the owner', async () => {
    const viewer = await core.user('viewer@retrieve.test');
    await addMember(core, ws, { email: 'viewer@retrieve.test', role: 'viewer' });
    const viewerAccess = await core.accessFor(viewer, ws);

    const [mine, theirs] = await Promise.all([
      retrieve(core, ws, 'third quarter revenue'),
      retrieve(core, viewerAccess, 'third quarter revenue'),
    ]);
    expect(theirs.map((s) => s.chunkId)).toEqual(mine.map((s) => s.chunkId));
  });
});
