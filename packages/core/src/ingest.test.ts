import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeFailure } from './ingest';
import { createHashEmbedder, EmbeddingError, type Embedder } from './embeddings';
import {
  addMember,
  PermanentIngestError,
  processDocument,
  removeMember,
  uploadDocument,
  type DocumentDoc,
  type WorkspaceAccess,
} from './index';
import { createTestCore, type TestCore } from './test/context';
import { makePdf } from './test/pdf';

let core: TestCore;
let ws: WorkspaceAccess;
let owner: Awaited<ReturnType<TestCore['user']>>;
beforeAll(async () => {
  core = await createTestCore({ CHUNK_TARGET_TOKENS: '40', CHUNK_OVERLAP_TOKENS: '8' });
  owner = await core.user('owner@ingest.test');
  ws = await core.workspace(owner);
});
afterAll(() => core.destroy());

const bytes = (text: string) => new TextEncoder().encode(text);
const jobFor = (id: string) => ({
  documentId: id,
  workspaceId: ws.workspaceId.toHexString(),
  userId: owner._id.toHexString(),
});
async function stored(id: string): Promise<DocumentDoc> {
  return (await core.database.documents.findOne({ _id: new ObjectId(id) }))!;
}
const longText = Array.from(
  { length: 40 },
  (_, i) => `Fact ${i} about the quarterly results.`,
).join(' ');

describe('processDocument', () => {
  it('turns a text file into embedded chunks and marks it indexed', async () => {
    const doc = await uploadDocument(core, ws, { name: 'a.txt', bytes: bytes(longText) });
    await processDocument(core, jobFor(doc.id));

    const after = await stored(doc.id);
    expect(after).toMatchObject({ status: 'indexed', error: null, pageCount: 1 });
    const chunks = await core.database.chunks
      .find({ documentId: after._id })
      .sort({ ord: 1 })
      .toArray();
    expect(chunks.length).toBe(after.chunkCount);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.workspaceId.equals(ws.workspaceId)).toBe(true);
      expect(chunk.embedding).toHaveLength(core.config.EMBEDDING_DIMENSIONS);
      expect(chunk.embeddingModel).toBe('feature-hashing');
    }
  });

  it('keeps the page of every chunk of a PDF', async () => {
    const pdf = makePdf([['Alpha findings on page one.'], ['Beta findings on page two.']]);
    const doc = await uploadDocument(core, ws, { name: 'r.pdf', bytes: pdf });
    await processDocument(core, jobFor(doc.id));

    const after = await stored(doc.id);
    expect(after).toMatchObject({ status: 'indexed', pageCount: 2 });
    const chunks = await core.database.chunks
      .find({ documentId: after._id })
      .sort({ ord: 1 })
      .toArray();
    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
    expect(chunks[0]?.text).toContain('Alpha');
    expect(chunks[1]?.text).toContain('Beta');
  });

  it('reads an image through the OCR step', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const doc = await uploadDocument(core, ws, { name: 'scan.png', bytes: png });
    await processDocument(core, jobFor(doc.id), { ocr: async () => 'Invoice total 1200 dollars' });

    const chunks = await core.database.chunks.find({ documentId: new ObjectId(doc.id) }).toArray();
    expect(chunks.map((c) => c.text)).toEqual(['Invoice total 1200 dollars']);
  });

  it('can run twice for one document without duplicating its chunks', async () => {
    const doc = await uploadDocument(core, ws, { name: 'twice.txt', bytes: bytes(longText) });
    await processDocument(core, jobFor(doc.id));
    const first = await core.database.chunks.countDocuments({ documentId: new ObjectId(doc.id) });
    await processDocument(core, jobFor(doc.id));
    const second = await core.database.chunks.countDocuments({ documentId: new ObjectId(doc.id) });

    expect(second).toBe(first);
  });

  it('fails a PDF with no text, and says why', async () => {
    const doc = await uploadDocument(core, ws, { name: 'blank.pdf', bytes: makePdf([[' ']]) });
    await expect(processDocument(core, jobFor(doc.id))).rejects.toBeInstanceOf(
      PermanentIngestError,
    );

    expect(await stored(doc.id)).toMatchObject({ status: 'failed' });
    expect((await stored(doc.id)).error).toMatch(/Scanned PDFs are not supported/);
  });

  it('fails a damaged PDF permanently, with a message the user can act on', async () => {
    const doc = await uploadDocument(core, ws, {
      name: 'bad.pdf',
      bytes: bytes('%PDF-1.4 garbage'),
    });
    await expect(processDocument(core, jobFor(doc.id))).rejects.toBeInstanceOf(
      PermanentIngestError,
    );
    expect((await stored(doc.id)).error).toMatch(/could not be read/);
  });

  it('does nothing for a document that was deleted while it waited', async () => {
    await expect(
      processDocument(core, jobFor(new ObjectId().toHexString())),
    ).resolves.toBeUndefined();
  });

  it('does not bring back a document deleted while it was being embedded', async () => {
    const doc = await uploadDocument(core, ws, { name: 'race.txt', bytes: bytes(longText) });
    const deleting: Embedder = {
      ...createHashEmbedder(8),
      async embed(texts) {
        await core.database.documents.deleteOne({ _id: new ObjectId(doc.id) });
        return createHashEmbedder(8).embed(texts);
      },
    };
    await processDocument({ ...core, embedder: deleting }, jobFor(doc.id));

    expect(await core.database.documents.findOne({ _id: new ObjectId(doc.id) })).toBeNull();
    expect(await core.database.chunks.countDocuments({ documentId: new ObjectId(doc.id) })).toBe(0);
  });

  it('refuses to work for an uploader who has since been removed', async () => {
    const editor = await core.user('editor@ingest.test');
    await addMember(core, ws, { email: 'editor@ingest.test', role: 'editor' });
    const editorAccess = await core.accessFor(editor, ws, 'editor');
    const doc = await uploadDocument(core, editorAccess, {
      name: 'late.txt',
      bytes: bytes(longText),
    });
    await removeMember(core, ws, editor._id);

    await expect(
      processDocument(core, { ...jobFor(doc.id), userId: editor._id.toHexString() }),
    ).rejects.toBeInstanceOf(PermanentIngestError);
    expect(await stored(doc.id)).toMatchObject({ status: 'failed' });
    expect(await core.database.chunks.countDocuments({ documentId: new ObjectId(doc.id) })).toBe(0);
  });
});

describe('embedding failures', () => {
  const failing = (error: EmbeddingError): Embedder => ({
    ...createHashEmbedder(8),
    embed: async () => {
      throw error;
    },
  });

  it('lets a temporary failure through, so the queue retries, and does not mark the file failed', async () => {
    const doc = await uploadDocument(core, ws, { name: 'temp.txt', bytes: bytes(longText) });
    const unreachable = new EmbeddingError('unreachable', true);

    await expect(
      processDocument({ ...core, embedder: failing(unreachable) }, jobFor(doc.id)),
    ).rejects.toBe(unreachable);
    expect((await stored(doc.id)).status).toBe('embedding');
  });

  it('fails permanently when the service rejects the request', async () => {
    const doc = await uploadDocument(core, ws, { name: 'rejected.txt', bytes: bytes(longText) });
    const rejected = failing(new EmbeddingError('bad key', false));

    await expect(
      processDocument({ ...core, embedder: rejected }, jobFor(doc.id)),
    ).rejects.toBeInstanceOf(PermanentIngestError);
    expect((await stored(doc.id)).error).toMatch(/embedding service rejected/);
  });

  it('gives up on a stage that takes too long', async () => {
    const slowCore = await createTestCore({ INGEST_STAGE_TIMEOUT_MS: '30' });
    try {
      const slowWs = await slowCore.workspace(await slowCore.user('slow@ingest.test'));
      const doc = await uploadDocument(slowCore, slowWs, { name: 's.txt', bytes: bytes(longText) });
      const hang: Embedder = { ...createHashEmbedder(8), embed: () => new Promise(() => {}) };
      const job = {
        documentId: doc.id,
        workspaceId: slowWs.workspaceId.toHexString(),
        userId: slowWs.userId.toHexString(),
      };

      await expect(processDocument({ ...slowCore, embedder: hang }, job)).rejects.toThrow(
        /took longer/,
      );
    } finally {
      await slowCore.destroy();
    }
  });
});

describe('describeFailure', () => {
  it('says what went wrong in words a person can act on, without a provider body', () => {
    expect(
      describeFailure(new EmbeddingError('The embedding service answered 429.', true)),
    ).toMatch(/kept refusing requests \(The embedding service answered 429\).*smaller file/);
    expect(describeFailure(new Error('The embedding stage took longer than 300000 ms.'))).toMatch(
      /took too long/,
    );
    expect(describeFailure(new Error('The parser stopped without an answer (SIGKILL).'))).toMatch(
      /could not be read/,
    );
    expect(describeFailure(new Error('anything else'))).toMatch(/failed after 3 attempts/);
  });
});
