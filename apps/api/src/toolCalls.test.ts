import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { proposeToolCalls, requireAccess } from '@atlas/core';
import { createTestCore } from '@atlas/core/test';
import { createTestApp, type Client, type TestApp } from './test/context';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    ...(await createTestCore()),
    searchAvailable: false,
    recheckSearch: async () => false,
  });
});
afterAll(() => t.destroy());

const noteCall = (title = 'Agenda', text = 'Agree the agenda.') =>
  JSON.stringify({ tool: 'save_note', args: { title, text } });

async function setup() {
  const tag = Math.random().toString(36).slice(2);
  const owner = await t.signUp(`olivia${tag}@tools.test`);
  const editor = await t.signUp(`eddie${tag}@tools.test`);
  const viewer = await t.signUp(`vera${tag}@tools.test`);
  const ws = (await owner.post('/workspaces').send({ name: 'W' }).expect(201)).body.workspace
    .id as string;
  for (const [who, role] of [
    ['eddie', 'editor'],
    ['vera', 'viewer'],
  ] as const) {
    await owner
      .post(`/workspaces/${ws}/members`)
      .send({ email: `${who}${tag}@tools.test`, role })
      .expect(201);
  }
  return { owner, editor, viewer, ws };
}

// Makes the assistant ask for something in one of this person's conversations, as an answer would.
async function ask(client: Client, ws: string, raw = noteCall()) {
  const userId = new ObjectId((await client.get('/auth/me')).body.user.id);
  const conversationId = (await client.post(`/workspaces/${ws}/conversations`).expect(201)).body
    .conversation.id as string;
  const access = await requireAccess(t.core, userId, new ObjectId(ws));
  const [doc] = await proposeToolCalls(
    t.core,
    access,
    new ObjectId(conversationId),
    new ObjectId(),
    [{ raw }],
  );
  return { id: doc!._id.toHexString(), conversationId };
}

describe('deciding a tool request over HTTP', () => {
  it('needs a signed-in user', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws);
    await t
      .anonymous()
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(401);
    await t.anonymous().get(`/workspaces/${ws}/tool-calls`).expect(401);
  });

  it('shows the request with the conversation, waiting', async () => {
    const { owner, ws } = await setup();
    const { id, conversationId } = await ask(owner, ws);
    const res = await owner.get(`/workspaces/${ws}/conversations/${conversationId}`).expect(200);
    expect(res.body.toolCalls).toEqual([
      expect.objectContaining({
        id,
        tool: 'save_note',
        status: 'proposed',
        args: { title: 'Agenda', text: 'Agree the agenda.' },
      }),
    ]);
  });

  it('approving runs it, and the note appears among the documents', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws, noteCall('Board prep', 'Items for Monday.'));

    const res = await owner
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(200);
    expect(res.body.toolCall).toMatchObject({
      status: 'executed',
      result: { summary: 'Saved as "Board prep.md"' },
    });

    const documents = await owner.get(`/workspaces/${ws}/documents`).expect(200);
    expect(documents.body.documents.map((d: { name: string }) => d.name)).toContain(
      'Board prep.md',
    );
  });

  it('rejecting runs nothing', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws, noteCall('Unwanted'));
    const res = await owner
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'reject' })
      .expect(200);

    expect(res.body.toolCall.status).toBe('rejected');
    expect((await owner.get(`/workspaces/${ws}/documents`)).body.documents).toEqual([]);
  });

  it('answers a second decision with 409', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws);
    await owner
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(200);
    const again = await owner
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(409);
    expect(again.body.error.code).toBe('conflict');
  });

  it('runs once when the same approval is sent several times at once', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws, noteCall('Double click'));
    const statuses = await Promise.all(
      Array.from({ length: 4 }, () =>
        owner
          .post(`/workspaces/${ws}/tool-calls/${id}`)
          .send({ decision: 'approve' })
          .then((r) => r.status),
      ),
    );

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    const names = (await owner.get(`/workspaces/${ws}/documents`)).body.documents.map(
      (d: { name: string }) => d.name,
    );
    expect(names.filter((n: string) => n === 'Double click.md')).toHaveLength(1);
  });

  it('refuses a decision that is not approve or reject, and an id that is not one', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws);
    await owner
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'execute' })
      .expect(400);
    await owner.post(`/workspaces/${ws}/tool-calls/${id}`).send({}).expect(400);
    await owner
      .post(`/workspaces/${ws}/tool-calls/not-an-id`)
      .send({ decision: 'approve' })
      .expect(404);
  });

  it('hides the request from a colleague while the conversation is private, and keeps them from deciding it once shared', async () => {
    const { owner, editor, ws } = await setup();
    const { id, conversationId } = await ask(owner, ws, noteCall('Mine only'));
    const path = `/workspaces/${ws}/tool-calls/${id}`;

    await editor.post(path).send({ decision: 'approve' }).expect(404);
    await owner
      .patch(`/workspaces/${ws}/conversations/${conversationId}`)
      .send({ visibility: 'workspace' })
      .expect(200);

    // they can read the conversation, and the request in it, but not answer it
    const seen = await editor.get(`/workspaces/${ws}/conversations/${conversationId}`).expect(200);
    expect(seen.body.toolCalls[0].status).toBe('proposed');
    await editor.post(path).send({ decision: 'approve' }).expect(403);
    await editor.post(path).send({ decision: 'reject' }).expect(403);
    expect((await owner.get(`/workspaces/${ws}/documents`)).body.documents).toEqual([]);
  });

  it('does not let a viewer approve anything, whatever the request says', async () => {
    const { viewer, ws } = await setup();
    // a viewer's own request is refused when it is made
    const { id } = await ask(viewer, ws);
    const trail = await viewer.get(`/workspaces/${ws}/tool-calls`).expect(200);
    expect(trail.body.toolCalls[0]).toMatchObject({ id, status: 'invalid' });
    await viewer
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(409);
  });

  it('answers an outsider as it answers a request that does not exist', async () => {
    const { owner, ws } = await setup();
    const outsider = await t.signUp(`out${Math.random().toString(36).slice(2)}@tools.test`);
    const { id } = await ask(owner, ws);

    const real = await outsider
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(404);
    const none = await outsider
      .post('/workspaces/0123456789abcdef01234567/tool-calls/0123456789abcdef01234567')
      .send({ decision: 'approve' })
      .expect(404);
    expect(real.body).toEqual(none.body);
  });
});

describe('the audit trail', () => {
  it('gives the owner every request, and an editor only their own', async () => {
    const { owner, editor, ws } = await setup();
    await ask(owner, ws, noteCall('Owner asked'));
    await ask(editor, ws, noteCall('Editor asked'));
    await ask(editor, ws, 'garbage that is not a request');

    const asOwner = (await owner.get(`/workspaces/${ws}/tool-calls`).expect(200)).body.toolCalls;
    const asEditor = (await editor.get(`/workspaces/${ws}/tool-calls`).expect(200)).body.toolCalls;
    expect(asOwner).toHaveLength(3);
    expect(asEditor).toHaveLength(2);
    expect(
      asEditor.every((c: { proposedByName: string }) => c.proposedByName.startsWith('eddie')),
    ).toBe(true);
    // refused requests are part of the record
    expect(asOwner.filter((c: { status: string }) => c.status === 'invalid')).toHaveLength(1);
  });

  it('records who decided and when', async () => {
    const { owner, ws } = await setup();
    const { id } = await ask(owner, ws);
    await owner
      .post(`/workspaces/${ws}/tool-calls/${id}`)
      .send({ decision: 'approve' })
      .expect(200);

    const [entry] = (await owner.get(`/workspaces/${ws}/tool-calls`).expect(200)).body.toolCalls;
    expect(entry).toMatchObject({
      id,
      status: 'executed',
      decidedByName: expect.stringMatching(/^olivia/),
    });
    expect(new Date(entry.decidedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('shows an outsider nothing, not an empty list', async () => {
    const { ws } = await setup();
    const outsider = await t.signUp(`out${Math.random().toString(36).slice(2)}@tools.test`);
    await outsider.get(`/workspaces/${ws}/tool-calls`).expect(404);
  });
});
