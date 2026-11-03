import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
  type UserDoc,
  type WorkspaceAccess,
} from './index';
import { createTestCore, type TestCore } from './test/context';

let core: TestCore;
let ws: WorkspaceAccess; // owned by Olivia
let olivia: UserDoc;
let eddie: UserDoc;
let eddieAccess: WorkspaceAccess;
beforeAll(async () => {
  core = await createTestCore();
  olivia = await core.user('olivia@conv.test', { name: 'Olivia' });
  eddie = await core.user('eddie@conv.test', { name: 'Eddie' });
  ws = await core.workspace(olivia);
  await addMember(core, ws, { email: 'eddie@conv.test', role: 'viewer' });
  eddieAccess = await core.accessFor(eddie, ws);
});
afterAll(() => core.destroy());

async function say(conversationId: string, text: string, role: 'user' | 'assistant' = 'user') {
  await core.database.messages.insertOne({
    _id: new ObjectId(),
    conversationId: new ObjectId(conversationId),
    workspaceId: ws.workspaceId,
    role,
    content: text,
    status: 'complete',
    error: null,
    citations: [],
    usage: null,
    costUsd: null,
    latency: null,
    model: null,
    createdAt: new Date(),
  });
}

describe('sharing policy', () => {
  it('keeps a conversation private to its author, and hides that it exists', async () => {
    const mine = await createConversation(core, ws);
    const id = new ObjectId(mine.id);

    const asEddie = await getConversation(core, eddieAccess, id).catch((e) => e);
    const asMissing = await getConversation(core, eddieAccess, new ObjectId()).catch((e) => e);
    expect(asEddie).toMatchObject({ status: 404 });
    expect(asEddie.message).toBe(asMissing.message);
    expect((await listConversations(core, eddieAccess)).map((c) => c.id)).not.toContain(mine.id);
  });

  it('lets every member read a shared conversation, and only the author change it', async () => {
    const shared = await createConversation(core, ws);
    const id = new ObjectId(shared.id);
    await updateConversation(core, ws, id, { visibility: 'workspace' });

    const read = await getConversation(core, eddieAccess, id);
    expect(read.conversation).toMatchObject({
      visibility: 'workspace',
      authorName: 'Olivia',
      mine: false,
    });
    expect((await listConversations(core, eddieAccess)).map((c) => c.id)).toContain(shared.id);

    await expect(
      updateConversation(core, eddieAccess, id, { title: 'Mine now' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateConversation(core, eddieAccess, id, { visibility: 'private' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(deleteConversation(core, eddieAccess, id)).rejects.toMatchObject({ status: 403 });
  });

  it('takes the conversation back out of sight when it is made private again', async () => {
    const c = await createConversation(core, ws);
    const id = new ObjectId(c.id);
    await updateConversation(core, ws, id, { visibility: 'workspace' });
    await updateConversation(core, ws, id, { visibility: 'private' });
    await expect(getConversation(core, eddieAccess, id)).rejects.toMatchObject({ status: 404 });
  });

  it('never shows a conversation in another workspace, even to its own author', async () => {
    const other = await core.workspace(olivia);
    const elsewhere = await createConversation(core, other);

    await expect(getConversation(core, ws, new ObjectId(elsewhere.id))).rejects.toMatchObject({
      status: 404,
    });
    expect((await listConversations(core, ws)).map((c) => c.id)).not.toContain(elsewhere.id);
  });
});

describe('history', () => {
  it('lists mine and what is shared, most recently active first', async () => {
    const local = await createTestCore();
    try {
      const owner = await local.user('o@hist.test');
      const wsA = await local.workspace(owner);
      const first = await createConversation(local, wsA);
      const second = await createConversation(local, wsA);
      await local.database.conversations.updateOne(
        { _id: new ObjectId(first.id) },
        { $set: { updatedAt: new Date(Date.now() + 5000) } },
      );

      expect((await listConversations(local, wsA)).map((c) => c.id)).toEqual([first.id, second.id]);
    } finally {
      await local.destroy();
    }
  });

  it('finds a conversation by a word in its title or in any message', async () => {
    const c = await createConversation(core, ws);
    await updateConversation(core, ws, new ObjectId(c.id), { title: 'Quarterly planning' });
    await say(c.id, 'Remind me about the zeppelin budget');
    await say(c.id, 'The zeppelin budget is two million.', 'assistant');

    expect((await listConversations(core, ws, 'zeppelin')).map((x) => x.id)).toContain(c.id);
    expect((await listConversations(core, ws, 'planning')).map((x) => x.id)).toContain(c.id);
    expect((await listConversations(core, ws, 'nonexistentword')).map((x) => x.id)).not.toContain(
      c.id,
    );
  });

  it("does not let a search turn up someone else's private conversation", async () => {
    const secret = await createConversation(core, ws);
    await say(secret.id, 'Draft the redundancy letter for the platypus team');

    expect((await listConversations(core, ws, 'platypus')).map((c) => c.id)).toContain(secret.id);
    expect((await listConversations(core, eddieAccess, 'platypus')).map((c) => c.id)).not.toContain(
      secret.id,
    );

    await updateConversation(core, ws, new ObjectId(secret.id), { visibility: 'workspace' });
    expect((await listConversations(core, eddieAccess, 'platypus')).map((c) => c.id)).toContain(
      secret.id,
    );
  });
});

describe('editing', () => {
  it('renames, and refuses a rename to nothing', async () => {
    const c = await createConversation(core, ws);
    const renamed = await updateConversation(core, ws, new ObjectId(c.id), { title: 'Board prep' });
    expect(renamed.title).toBe('Board prep');
  });

  it("deletes the conversation with all of its messages, and nobody else's", async () => {
    const gone = await createConversation(core, ws);
    const kept = await createConversation(core, ws);
    await say(gone.id, 'one');
    await say(gone.id, 'two', 'assistant');
    await say(kept.id, 'stays');

    await deleteConversation(core, ws, new ObjectId(gone.id));

    expect(
      await core.database.messages.countDocuments({ conversationId: new ObjectId(gone.id) }),
    ).toBe(0);
    expect(
      await core.database.messages.countDocuments({ conversationId: new ObjectId(kept.id) }),
    ).toBe(1);
    await expect(getConversation(core, ws, new ObjectId(gone.id))).rejects.toMatchObject({
      status: 404,
    });
  });
});
