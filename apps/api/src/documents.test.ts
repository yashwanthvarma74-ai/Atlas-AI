import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UPLOAD_MAX_BYTES } from '@atlas/shared';
import { createTestApp, type Client, type TestApp } from './test/context';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.destroy());

const upload = (client: Client, workspaceId: string, body: Buffer | string, name = 'notes.txt') =>
  client
    .post(`/workspaces/${workspaceId}/documents`)
    .query({ name })
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from(body));

async function workspaceWith(owner: Client) {
  return (await owner.post('/workspaces').send({ name: 'Research' }).expect(201)).body.workspace
    .id as string;
}

async function invite(
  owner: Client,
  workspaceId: string,
  email: string,
  role: 'viewer' | 'editor',
) {
  await owner.post(`/workspaces/${workspaceId}/members`).send({ email, role }).expect(201);
}

describe('uploading', () => {
  it('accepts a file from an editor and answers 202 while it is processed', async () => {
    const owner = await t.signUp('owner@up.test');
    const id = await workspaceWith(owner);

    const res = await upload(owner, id, 'Quarterly revenue grew.').expect(202);
    expect(res.body.document).toMatchObject({ name: 'notes.txt', kind: 'text', status: 'queued' });

    const list = await owner.get(`/workspaces/${id}/documents`).expect(200);
    expect(list.body.documents).toHaveLength(1);
  });

  it('lets an editor upload and a viewer only read', async () => {
    const owner = await t.signUp('owner@roles.test');
    const editor = await t.signUp('editor@roles.test');
    const viewer = await t.signUp('viewer@roles.test');
    const id = await workspaceWith(owner);
    await invite(owner, id, 'editor@roles.test', 'editor');
    await invite(owner, id, 'viewer@roles.test', 'viewer');

    await upload(editor, id, 'from the editor').expect(202);
    const denied = await upload(viewer, id, 'from the viewer').expect(403);
    expect(denied.body.error.code).toBe('forbidden');
    expect(
      (await viewer.get(`/workspaces/${id}/documents`).expect(200)).body.documents,
    ).toHaveLength(1);
  });

  it('needs a signed-in user', async () => {
    const owner = await t.signUp('owner@anon.test');
    const id = await workspaceWith(owner);
    await t
      .anonymous()
      .post(`/workspaces/${id}/documents`)
      .query({ name: 'x.txt' })
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(401);
  });

  it('answers an outsider exactly as it answers a workspace that does not exist', async () => {
    const owner = await t.signUp('owner@out.test');
    const outsider = await t.signUp('outsider@out.test');
    const id = await workspaceWith(owner);

    const real = await upload(outsider, id, 'sneaky').expect(404);
    const none = await upload(outsider, '0123456789abcdef01234567', 'sneaky').expect(404);
    expect(real.body).toEqual(none.body);
    expect((await outsider.get(`/workspaces/${id}/documents`).expect(404)).body).toEqual(
      (await outsider.get('/workspaces/0123456789abcdef01234567/documents').expect(404)).body,
    );
  });

  it('refuses a binary file with 415, whatever it is called', async () => {
    const owner = await t.signUp('owner@bin.test');
    const id = await workspaceWith(owner);
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    const res = await upload(owner, id, exe, 'report.pdf').expect(415);
    expect(res.body.error.code).toBe('unsupported_media');
  });

  it('refuses an empty file, a missing name and a wrong Content-Type', async () => {
    const owner = await t.signUp('owner@bad.test');
    const id = await workspaceWith(owner);

    await upload(owner, id, '').expect(400);
    await owner
      .post(`/workspaces/${id}/documents`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(400);
    await owner
      .post(`/workspaces/${id}/documents`)
      .query({ name: 'a.json' })
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(415);
  });

  it('cuts off a file over the size limit', async () => {
    const owner = await t.signUp('owner@big.test');
    const id = await workspaceWith(owner);
    const res = await upload(owner, id, Buffer.alloc(UPLOAD_MAX_BYTES + 1, 97)).expect(413);
    expect(res.body.error.code).toBe('too_large');
  });
});

describe('reading and managing', () => {
  it('downloads the original as an attachment that is never rendered in place', async () => {
    const owner = await t.signUp('owner@dl.test');
    const viewer = await t.signUp('viewer@dl.test');
    const id = await workspaceWith(owner);
    await invite(owner, id, 'viewer@dl.test', 'viewer');
    const doc = (await upload(owner, id, '<script>alert(1)</script>', 'Q3 report.txt').expect(202))
      .body.document;

    const res = await viewer.get(`/workspaces/${id}/documents/${doc.id}/file`).expect(200);
    expect(res.text).toBe('<script>alert(1)</script>');
    expect(res.headers['content-disposition']).toBe("attachment; filename*=UTF-8''Q3%20report.txt");
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('does not serve a document through another workspace', async () => {
    const owner = await t.signUp('owner@cross.test');
    const other = await t.signUp('other@cross.test');
    const mine = await workspaceWith(owner);
    const theirs = await workspaceWith(other);
    const doc = (await upload(owner, mine, 'private').expect(202)).body.document;

    // the other user is a real member of `theirs`, and names my document's id inside it
    await other.get(`/workspaces/${theirs}/documents/${doc.id}`).expect(404);
    await other.get(`/workspaces/${theirs}/documents/${doc.id}/file`).expect(404);
    await other.delete(`/workspaces/${theirs}/documents/${doc.id}`).expect(404);
    await other.post(`/workspaces/${theirs}/documents/${doc.id}/retry`).expect(404);
    await owner.get(`/workspaces/${mine}/documents/${doc.id}`).expect(200);
  });

  it('lets an editor delete, and a viewer not', async () => {
    const owner = await t.signUp('owner@del.test');
    const viewer = await t.signUp('viewer@del.test');
    const id = await workspaceWith(owner);
    await invite(owner, id, 'viewer@del.test', 'viewer');
    const doc = (await upload(owner, id, 'to be removed').expect(202)).body.document;

    await viewer.delete(`/workspaces/${id}/documents/${doc.id}`).expect(403);
    await owner.delete(`/workspaces/${id}/documents/${doc.id}`).expect(204);
    await owner.get(`/workspaces/${id}/documents/${doc.id}`).expect(404);
  });

  it('retries only a failed document', async () => {
    const owner = await t.signUp('owner@retry.test');
    const id = await workspaceWith(owner);
    const doc = (await upload(owner, id, 'some text').expect(202)).body.document;

    await owner.post(`/workspaces/${id}/documents/${doc.id}/retry`).expect(400);
    await t.core.database.documents.updateOne(
      { _id: new ObjectId(doc.id) },
      { $set: { status: 'failed', error: 'x' } },
    );
    const res = await owner.post(`/workspaces/${id}/documents/${doc.id}/retry`).expect(202);
    expect(res.body.document.status).toBe('queued');
  });

  it('treats a malformed document id as not found', async () => {
    const owner = await t.signUp('owner@id.test');
    const id = await workspaceWith(owner);
    await owner.get(`/workspaces/${id}/documents/not-an-id`).expect(404);
  });
});
