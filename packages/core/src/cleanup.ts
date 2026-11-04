import type { Filter, ObjectId } from 'mongodb';
import type { Core } from './core';
import type { ConversationDoc, DocumentDoc } from './db';
import { hex } from './ids';
import { cancelIngest } from './queues';

// Every way data is removed goes through here: a person clearing their own workspaces, documents and conversations
// that have outlived the demo's lifetime, and guests that have expired. One path means one set of tests for "nothing
// is left behind": not a passage in the search index, not a file in storage, not a queued job.

// Documents with their passages, their originals in storage and any job still waiting for them.
export async function removeDocuments(core: Core, filter: Filter<DocumentDoc>): Promise<number> {
  const documents = await core.database.documents.find(filter).toArray();
  if (documents.length === 0) return 0;
  const ids = documents.map((doc) => doc._id);
  // rows first, so a worker that is mid-way through a document finds nothing to bring back
  await core.database.documents.deleteMany({ _id: { $in: ids } });
  await core.database.chunks.deleteMany({ documentId: { $in: ids } });
  for (const doc of documents) {
    await cancelIngest(core.queues, hex(doc._id)).catch(() => undefined);
    await core.storage.delete(doc.storageKey);
  }
  return documents.length;
}

// Conversations with their messages and the tool calls proposed in them.
export async function removeConversations(
  core: Core,
  filter: Filter<ConversationDoc>,
): Promise<number> {
  const conversations = await core.database.conversations
    .find(filter)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  if (conversations.length === 0) return 0;
  const ids = conversations.map((c) => c._id);
  await core.database.conversations.deleteMany({ _id: { $in: ids } });
  await core.database.messages.deleteMany({ conversationId: { $in: ids } });
  await core.database.toolCalls.deleteMany({ conversationId: { $in: ids } });
  return conversations.length;
}

// Leaves a workspace as it was the day it was made: the workspace and its members stay, its contents go.
export async function emptyWorkspace(core: Core, workspaceId: ObjectId) {
  return {
    documents: await removeDocuments(core, { workspaceId }),
    conversations: await removeConversations(core, { workspaceId }),
  };
}

// Empties every workspace this person owns. A workspace they were only invited to belongs to someone else, and is left
// alone. The caller has proved who they are; there is no workspace id to trust, because it acts on their own.
export async function clearOwnWorkspaces(core: Core, userId: ObjectId) {
  const owned = await core.database.workspaces
    .find({ ownerId: userId })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const removed = { documents: 0, conversations: 0 };
  for (const workspace of owned) {
    const result = await emptyWorkspace(core, workspace._id);
    removed.documents += result.documents;
    removed.conversations += result.conversations;
  }
  return removed;
}

// Removes documents and conversations made more than `hours` ago, everyone's: the demo keeps nothing longer.
export async function removeOlderThan(core: Core, hours: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const removed = {
    documents: await removeDocuments(core, { createdAt: { $lt: cutoff } }),
    conversations: await removeConversations(core, { createdAt: { $lt: cutoff } }),
  };
  if (removed.documents + removed.conversations > 0) {
    core.logger.info(removed, `documents and conversations older than ${hours} h removed`);
  }
  return removed;
}
