import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UPLOAD_MAX_BYTES } from '@atlas/shared';
import {
  deleteDocument,
  getDocument,
  listDocuments,
  openDocumentFile,
  retryDocument,
  uploadDocument,
  type WorkspaceAccess,
} from './index';
import { createTestCore, type TestCore } from './test/context';

let core: TestCore;
let ws: WorkspaceAccess;
beforeAll(async () => {
  core = await createTestCore();
  ws = await core.workspace(await core.user('owner@docs.test'));
});
afterAll(() => core.destroy());

const text = (content: string) => new TextEncoder().encode(content);
const upload = (name: string, content = 'Some notes about revenue.') =>
  uploadDocument(core, ws, { name, bytes: text(content) });

describe('uploadDocument', () => {
  it('stores the file, records it as queued and puts a job on the queue', async () => {
    const doc = await upload('notes.txt');

    expect(doc).toMatchObject({ name: 'notes.txt', kind: 'text', status: 'queued', error: null });
    const stored = await core.database.documents.findOne({ _id: new ObjectId(doc.id) });
    expect(new TextDecoder().decode(await core.storage.get(stored!.storageKey))).toBe(
      'Some notes about revenue.',
    );
    const job = await core.queues.ingest.getJob(doc.id);
    expect(job?.data).toMatchObject({ documentId: doc.id });
  });

  it('decides the type from the bytes, not from the name', async () => {
    const doc = await upload('totally-a-picture.png', 'plain words, not a picture');
    expect(doc.kind).toBe('text');
  });

  it('refuses a file that is not a PDF, an image or text', async () => {
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    await expect(uploadDocument(core, ws, { name: 'a.pdf', bytes: exe })).rejects.toMatchObject({
      status: 415,
    });
  });

  it('refuses an empty file and a file over the limit', async () => {
    await expect(upload('empty.txt', '')).rejects.toMatchObject({ status: 400 });
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 1).fill(97);
    await expect(uploadDocument(core, ws, { name: 'big.txt', bytes: big })).rejects.toMatchObject({
      status: 413,
    });
  });

  it('leaves nothing behind when the queue is down, and says so', async () => {
    const before = await core.database.documents.countDocuments();
    vi.spyOn(core.queues.ingest, 'add').mockRejectedValueOnce(new Error('Redis is away'));

    await expect(upload('lost.txt')).rejects.toMatchObject({ status: 503 });
    expect(await core.database.documents.countDocuments()).toBe(before);
  });
});

describe('reading documents', () => {
  it('lists newest first and only this workspace', async () => {
    const other = await core.workspace(await core.user('other@docs.test'));
    await uploadDocument(core, other, { name: 'elsewhere.txt', bytes: text('not ours') });
    const first = await upload('list-first.txt');
    const second = await upload('list-second.txt');

    const names = (await listDocuments(core, ws)).map((d) => d.name);
    expect(names.indexOf(second.name)).toBeLessThan(names.indexOf(first.name));
    expect(names).not.toContain('elsewhere.txt');
  });

  it('answers "not found" for a document that belongs to another workspace', async () => {
    const other = await core.workspace(await core.user('other2@docs.test'));
    const theirs = await uploadDocument(core, other, { name: 'secret.txt', bytes: text('secret') });
    const id = new ObjectId(theirs.id);

    await expect(getDocument(core, ws, id)).rejects.toMatchObject({ status: 404 });
    await expect(openDocumentFile(core, ws, id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteDocument(core, ws, id)).rejects.toMatchObject({ status: 404 });
    await expect(retryDocument(core, ws, id)).rejects.toMatchObject({ status: 404 });
    expect(await getDocument(core, other, id)).toMatchObject({ name: 'secret.txt' });
  });

  it('hands back the bytes to stream when the driver has no link', async () => {
    const doc = await upload('download.txt', 'download me');
    const file = await openDocumentFile(core, ws, new ObjectId(doc.id));
    expect(file).toMatchObject({ name: 'download.txt', mimeType: 'text/plain; charset=utf-8' });
    expect(new TextDecoder().decode('bytes' in file ? file.bytes : undefined)).toBe('download me');
  });
});

describe('deleteDocument', () => {
  it('removes the record, its chunks, the stored file and the waiting job', async () => {
    const doc = await upload('delete-me.txt');
    const id = new ObjectId(doc.id);
    const stored = await core.database.documents.findOne({ _id: id });
    await core.database.chunks.insertOne({
      _id: new ObjectId(),
      workspaceId: ws.workspaceId,
      documentId: id,
      ord: 0,
      page: 1,
      text: 'x',
      tokenCount: 1,
      embedding: [0],
      embeddingModel: 'test',
    });

    await deleteDocument(core, ws, id);

    expect(await core.database.documents.findOne({ _id: id })).toBeNull();
    expect(await core.database.chunks.countDocuments({ documentId: id })).toBe(0);
    await expect(core.storage.get(stored!.storageKey)).rejects.toThrow();
    expect(await core.queues.ingest.getJob(doc.id)).toBeUndefined();
  });
});

describe('retryDocument', () => {
  it('requeues a failed document and clears its error', async () => {
    const doc = await upload('retry.txt');
    const id = new ObjectId(doc.id);
    await core.queues.ingest.remove(doc.id);
    await core.database.documents.updateOne(
      { _id: id },
      { $set: { status: 'failed', error: 'boom' } },
    );

    const retried = await retryDocument(core, ws, id);

    expect(retried).toMatchObject({ status: 'queued', error: null });
    expect((await core.database.documents.findOne({ _id: id }))?.status).toBe('queued');
    expect(await core.queues.ingest.getJob(doc.id)).toBeDefined();
  });

  it('refuses to retry a document that has not failed', async () => {
    const doc = await upload('not-failed.txt');
    await expect(retryDocument(core, ws, new ObjectId(doc.id))).rejects.toMatchObject({
      status: 400,
    });
  });
});
