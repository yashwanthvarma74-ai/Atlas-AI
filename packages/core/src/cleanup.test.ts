import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkspaceAccess } from './access';
import { clearOwnWorkspaces, removeOlderThan } from './cleanup';
import { createConversation } from './conversations';
import { uploadDocument } from './documents';
import { createTestCore, type TestCore } from './test/context';
import { addMember } from './workspaces';

let core: TestCore;
beforeAll(async () => {
  core = await createTestCore();
});
afterAll(() => core.destroy());

const bytes = (text: string) => new TextEncoder().encode(text);

// A workspace with a document (and a passage for it, as if indexed) and a conversation.
async function filled(access: WorkspaceAccess, name: string) {
  const doc = await uploadDocument(core, access, { name, bytes: bytes(`Notes in ${name}.`) });
  await core.database.chunks.insertOne({
    _id: new ObjectId(),
    workspaceId: access.workspaceId,
    documentId: new ObjectId(doc.id),
    ord: 0,
    page: 1,
    text: `Notes in ${name}.`,
    tokenCount: 3,
    embedding: [1, 0],
    embeddingModel: 'test',
  });
  const conversation = await createConversation(core, access);
  return { documentId: new ObjectId(doc.id), conversationId: new ObjectId(conversation.id) };
}

const count = async (access: WorkspaceAccess) => ({
  documents: await core.database.documents.countDocuments({ workspaceId: access.workspaceId }),
  chunks: await core.database.chunks.countDocuments({ workspaceId: access.workspaceId }),
  conversations: await core.database.conversations.countDocuments({
    workspaceId: access.workspaceId,
  }),
});

describe('clearOwnWorkspaces', () => {
  it('empties the workspaces a person owns, files included, and leaves everyone else alone', async () => {
    const me = await core.user('me@cleanup.test');
    const other = await core.user('other@cleanup.test');
    const mine = await core.workspace(me);
    const theirs = await core.workspace(other);
    // invited to theirs: being a member does not make it mine to clear
    await addMember(core, theirs, { email: 'me@cleanup.test', role: 'editor' });
    const { documentId } = await filled(mine, 'mine.txt');
    await filled(theirs, 'theirs.txt');
    const key = (await core.database.documents.findOne({ _id: documentId }))!.storageKey;

    const removed = await clearOwnWorkspaces(core, me._id);

    expect(removed).toEqual({ documents: 1, conversations: 1 });
    expect(await count(mine)).toEqual({ documents: 0, chunks: 0, conversations: 0 });
    expect(await count(theirs)).toEqual({ documents: 1, chunks: 1, conversations: 1 });
    await expect(core.storage.get(key)).rejects.toThrow();
    // the workspace itself is still there, empty, and still theirs
    expect(await core.database.workspaces.countDocuments({ _id: mine.workspaceId })).toBe(1);
  });
});

describe('removeOlderThan', () => {
  it('removes documents and conversations past the lifetime, and keeps newer ones', async () => {
    const owner = await core.workspace(await core.user('old@cleanup.test'));
    const old = await filled(owner, 'old.txt');
    const fresh = await filled(owner, 'fresh.txt');
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await core.database.documents.updateOne(
      { _id: old.documentId },
      { $set: { createdAt: fourHoursAgo } },
    );
    await core.database.conversations.updateOne(
      { _id: old.conversationId },
      { $set: { createdAt: fourHoursAgo } },
    );

    const removed = await removeOlderThan(core, 3);

    expect(removed).toEqual({ documents: 1, conversations: 1 });
    expect(await core.database.documents.countDocuments({ _id: old.documentId })).toBe(0);
    expect(await core.database.chunks.countDocuments({ documentId: old.documentId })).toBe(0);
    expect(await core.database.documents.countDocuments({ _id: fresh.documentId })).toBe(1);
    expect(await core.database.conversations.countDocuments({ _id: fresh.conversationId })).toBe(1);
  });
});
