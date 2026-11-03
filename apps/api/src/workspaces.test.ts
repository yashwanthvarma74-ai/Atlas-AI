import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from './test/context';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.destroy());

async function createWorkspace(client: Client, name = 'Research'): Promise<string> {
  const res = await client.post('/workspaces').send({ name }).expect(201);
  return res.body.workspace.id;
}

describe('workspaces', () => {
  it('needs a signed-in user for every route', async () => {
    await t.anonymous().get('/workspaces').expect(401);
    await t.anonymous().post('/workspaces').send({ name: 'x' }).expect(401);
    await t.anonymous().get('/workspaces/0123456789abcdef01234567').expect(401);
  });

  it('creates a workspace owned by the caller', async () => {
    const ada = await t.signUp('ada@w.test');
    const res = await ada.post('/workspaces').send({ name: '  Q3 reports ' }).expect(201);
    expect(res.body.workspace).toMatchObject({ name: 'Q3 reports', role: 'owner' });

    const list = await ada.get('/workspaces').expect(200);
    expect(list.body.workspaces.map((w: { name: string }) => w.name)).toEqual(['Q3 reports']);
  });

  it('rejects a blank name', async () => {
    const ada = await t.signUp('blank@w.test');
    await ada.post('/workspaces').send({ name: '   ' }).expect(400);
    await ada.post('/workspaces').send({}).expect(400);
  });

  it('shows a member their role', async () => {
    const owner = await t.signUp('owner@role.w.test');
    const viewer = await t.signUp('viewer@role.w.test');
    const id = await createWorkspace(owner);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'viewer@role.w.test', role: 'viewer' })
      .expect(201);

    const res = await viewer.get(`/workspaces/${id}`).expect(200);
    expect(res.body.workspace.role).toBe('viewer');
  });
});

describe('tenant isolation', () => {
  it('answers an outsider exactly as it answers a workspace that does not exist', async () => {
    const owner = await t.signUp('owner@iso.test');
    const outsider = await t.signUp('outsider@iso.test');
    const id = await createWorkspace(owner);
    const missing = '0123456789abcdef01234567';

    for (const path of ['', '/members']) {
      const real = await outsider.get(`/workspaces/${id}${path}`).expect(404);
      const none = await outsider.get(`/workspaces/${missing}${path}`).expect(404);
      expect(real.body).toEqual(none.body);
    }
  });

  it('keeps an outsider from changing anything, however they try', async () => {
    const owner = await t.signUp('owner@iso2.test');
    const outsider = await t.signUp('outsider@iso2.test');
    await t.signUp('target@iso2.test');
    const id = await createWorkspace(owner);

    await outsider
      .post(`/workspaces/${id}/members`)
      .send({ email: 'outsider@iso2.test', role: 'editor' })
      .expect(404);
    await outsider
      .patch(`/workspaces/${id}/members/${await userId(owner)}`)
      .send({ role: 'viewer' })
      .expect(404);
    await outsider.delete(`/workspaces/${id}/members/${await userId(owner)}`).expect(404);

    const members = await owner.get(`/workspaces/${id}/members`).expect(200);
    expect(members.body.members).toHaveLength(1);
  });

  it('treats a malformed id as not found rather than as an error', async () => {
    const ada = await t.signUp('ada@badid.test');
    await ada.get('/workspaces/not-an-id').expect(404);
    await ada.get('/workspaces/%7B%22%24ne%22%3Anull%7D').expect(404);
  });

  it('does not list a workspace for someone who left it', async () => {
    const owner = await t.signUp('owner@left.test');
    const member = await t.signUp('member@left.test');
    const id = await createWorkspace(owner);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'member@left.test', role: 'editor' })
      .expect(201);
    await member.get(`/workspaces/${id}`).expect(200);

    await member.delete(`/workspaces/${id}/members/${await userId(member)}`).expect(204);
    await member.get(`/workspaces/${id}`).expect(404);
    expect((await member.get('/workspaces').expect(200)).body.workspaces).toEqual([]);
  });
});

describe('member management', () => {
  it('lets only the owner add people', async () => {
    const owner = await t.signUp('owner@add.w.test');
    const editor = await t.signUp('editor@add.w.test');
    await t.signUp('new@add.w.test');
    const id = await createWorkspace(owner);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'editor@add.w.test', role: 'editor' })
      .expect(201);

    const res = await editor
      .post(`/workspaces/${id}/members`)
      .send({ email: 'new@add.w.test', role: 'viewer' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('cannot make anyone an owner', async () => {
    const owner = await t.signUp('owner@promote.test');
    await t.signUp('other@promote.test');
    const id = await createWorkspace(owner);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'other@promote.test', role: 'owner' })
      .expect(400);
  });

  it('changes a role, and the change takes effect on the very next request', async () => {
    const owner = await t.signUp('owner@revoke.test');
    const editor = await t.signUp('editor@revoke.test');
    const id = await createWorkspace(owner);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'editor@revoke.test', role: 'editor' })
      .expect(201);
    await editor.get(`/workspaces/${id}/members`).expect(200);

    await owner
      .patch(`/workspaces/${id}/members/${await userId(editor)}`)
      .send({ role: 'viewer' })
      .expect(204);
    const me = await editor.get(`/workspaces/${id}`).expect(200);
    expect(me.body.workspace.role).toBe('viewer');

    await owner.delete(`/workspaces/${id}/members/${await userId(editor)}`).expect(204);
    await editor.get(`/workspaces/${id}`).expect(404);
  });

  it('will not remove or demote the owner', async () => {
    const owner = await t.signUp('owner@guard.w.test');
    const id = await createWorkspace(owner);
    const ownerId = await userId(owner);

    await owner.delete(`/workspaces/${id}/members/${ownerId}`).expect(403);
    await owner.patch(`/workspaces/${id}/members/${ownerId}`).send({ role: 'viewer' }).expect(403);
  });

  it('does not let a member remove somebody else', async () => {
    const owner = await t.signUp('owner@kick.test');
    const a = await t.signUp('a@kick.test');
    await t.signUp('b@kick.test');
    const id = await createWorkspace(owner);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'a@kick.test', role: 'editor' })
      .expect(201);
    const added = await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'b@kick.test', role: 'viewer' })
      .expect(201);

    await a.delete(`/workspaces/${id}/members/${added.body.member.userId}`).expect(403);
  });

  it('reports a missing account and a repeated invite distinctly', async () => {
    const owner = await t.signUp('owner@dup.test');
    await t.signUp('dup@dup.test');
    const id = await createWorkspace(owner);

    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'ghost@dup.test', role: 'viewer' })
      .expect(404);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'dup@dup.test', role: 'viewer' })
      .expect(201);
    await owner
      .post(`/workspaces/${id}/members`)
      .send({ email: 'dup@dup.test', role: 'viewer' })
      .expect(409);
  });
});

async function userId(client: Client): Promise<string> {
  return (await client.get('/auth/me').expect(200)).body.user.id;
}
