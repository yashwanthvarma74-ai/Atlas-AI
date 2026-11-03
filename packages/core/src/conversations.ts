import { ObjectId } from 'mongodb';
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  DEFAULT_CONVERSATION_TITLE,
  type Conversation,
  type Message,
  type UpdateConversationInput,
} from '@atlas/shared';
import type { WorkspaceAccess } from './access';
import type { Core } from './core';
import type { ConversationDoc, MessageDoc } from './db';
import { forbidden, notFound } from './errors';
import { hex } from './ids';

const LIST_LIMIT = 50;

export const toMessage = (doc: MessageDoc): Message => ({
  id: hex(doc._id),
  role: doc.role,
  content: doc.content,
  status: doc.status,
  error: doc.error,
  citations: doc.citations,
  usage: doc.usage,
  latency: doc.latency,
  createdAt: doc.createdAt.toISOString(),
});

// The whole sharing policy, in two lines. The workspace is already proved by the access object, so these
// only decide between its members: the author does everything, and everyone else reads what was shared.
const canRead = (conversation: ConversationDoc, access: WorkspaceAccess) =>
  conversation.userId.equals(access.userId) || conversation.visibility === 'workspace';
const canWrite = (conversation: ConversationDoc, access: WorkspaceAccess) =>
  conversation.userId.equals(access.userId);

// A private conversation of someone else's is "not found", the same as one that does not exist, so a
// member cannot tell that a colleague has been asking about, say, layoffs. A shared one that they may read
// but not change is a plain "no".
export async function loadConversation(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
  mode: 'read' | 'write',
): Promise<ConversationDoc> {
  const conversation = await core.database.conversations.findOne({
    _id: id,
    workspaceId: access.workspaceId,
  });
  if (!conversation || !canRead(conversation, access)) throw notFound('That conversation');
  if (mode === 'write' && !canWrite(conversation, access)) {
    throw forbidden('Only the person who started this conversation can change it.');
  }
  return conversation;
}

async function toConversations(
  core: Core,
  access: WorkspaceAccess,
  docs: ConversationDoc[],
): Promise<Conversation[]> {
  const authors = await core.database.users
    .find({
      _id: { $in: [...new Set(docs.map((d) => hex(d.userId)))].map((id) => new ObjectId(id)) },
    })
    .project<{ _id: ObjectId; name: string }>({ name: 1 })
    .toArray();
  const names = new Map(authors.map((a) => [hex(a._id), a.name]));

  return docs.map((doc) => ({
    id: hex(doc._id),
    title: doc.title,
    visibility: doc.visibility,
    authorId: hex(doc.userId),
    authorName: names.get(hex(doc.userId)) ?? 'Someone',
    mine: doc.userId.equals(access.userId),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }));
}

export async function createConversation(
  core: Core,
  access: WorkspaceAccess,
): Promise<Conversation> {
  const now = new Date();
  const doc: ConversationDoc = {
    _id: new ObjectId(),
    workspaceId: access.workspaceId,
    userId: access.userId,
    title: DEFAULT_CONVERSATION_TITLE,
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  };
  await core.database.conversations.insertOne(doc);
  return (await toConversations(core, access, [doc]))[0]!;
}

// My conversations and the ones shared with the workspace, most recently active first. With a search
// text, only those whose title or any message contains it.
export async function listConversations(
  core: Core,
  access: WorkspaceAccess,
  search?: string,
): Promise<Conversation[]> {
  const visible = {
    workspaceId: access.workspaceId,
    $or: [{ userId: access.userId }, { visibility: 'workspace' as const }],
  };

  let filter: object = visible;
  const text = search?.trim();
  if (text) {
    // $text matches whole words, case-insensitively, and ranks nothing here: results stay newest first
    const [byMessage, byTitle] = await Promise.all([
      core.database.messages
        .find({ workspaceId: access.workspaceId, $text: { $search: text } })
        .project<{ conversationId: ObjectId }>({ conversationId: 1 })
        .limit(500)
        .toArray(),
      core.database.conversations
        .find({ ...visible, $text: { $search: text } })
        .project<{ _id: ObjectId }>({ _id: 1 })
        .toArray(),
    ]);
    const ids = [...byMessage.map((m) => m.conversationId), ...byTitle.map((c) => c._id)];
    // a message hit only counts if its conversation is one this person may read: the `visible` filter
    // below does that, so a private conversation of someone else's never matches
    filter = { ...visible, _id: { $in: ids } };
  }

  const docs = await core.database.conversations
    .find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(LIST_LIMIT)
    .toArray();
  return toConversations(core, access, docs);
}

export async function getConversation(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<{ conversation: Conversation; messages: Message[] }> {
  const doc = await loadConversation(core, access, id, 'read');
  const messages = await core.database.messages
    .find({ conversationId: doc._id, workspaceId: access.workspaceId })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return {
    conversation: (await toConversations(core, access, [doc]))[0]!,
    messages: messages.map(toMessage),
  };
}

export async function updateConversation(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
  changes: UpdateConversationInput,
): Promise<Conversation> {
  const doc = await loadConversation(core, access, id, 'write');
  const set: Partial<ConversationDoc> = {};
  if (changes.title !== undefined)
    set.title = changes.title.slice(0, CONVERSATION_TITLE_MAX_LENGTH);
  if (changes.visibility !== undefined) set.visibility = changes.visibility;
  // sharing is not "activity", so it does not move the conversation to the top of everyone's history
  await core.database.conversations.updateOne(
    { _id: doc._id, workspaceId: access.workspaceId },
    { $set: set },
  );
  return (await toConversations(core, access, [{ ...doc, ...set }]))[0]!;
}

export async function deleteConversation(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<void> {
  const doc = await loadConversation(core, access, id, 'write');
  await core.database.conversations.deleteOne({ _id: doc._id, workspaceId: access.workspaceId });
  await core.database.messages.deleteMany({
    conversationId: doc._id,
    workspaceId: access.workspaceId,
  });
}
