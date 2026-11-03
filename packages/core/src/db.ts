import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type {
  Citation,
  EvalRun,
  ConversationVisibility,
  DocumentKind,
  DocumentStatus,
  MessageStatus,
  Role,
  ToolCallStatus,
} from '@atlas/shared';

export interface UserDoc {
  _id: ObjectId;
  name: string;
  // lower case; absent for guests, who have no way to sign in again
  email?: string;
  passwordHash?: string;
  guest: boolean;
  createdAt: Date;
}

export interface WorkspaceDoc {
  _id: ObjectId;
  name: string;
  ownerId: ObjectId;
  createdAt: Date;
}

export interface MembershipDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  userId: ObjectId;
  role: Role;
  createdAt: Date;
}

export interface DocumentDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  // the name the user gave it, shown back to them and used for downloads
  name: string;
  kind: DocumentKind;
  mimeType: string;
  size: number;
  // where the original lives in storage; the bytes are never in the database
  storageKey: string;
  status: DocumentStatus;
  // set only while status is "failed"
  error: string | null;
  pageCount: number | null;
  chunkCount: number | null;
  uploadedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChunkDoc {
  _id: ObjectId;
  // repeated from the document so a search can filter on it inside the query itself
  workspaceId: ObjectId;
  documentId: ObjectId;
  // position in the document, in reading order
  ord: number;
  page: number;
  text: string;
  tokenCount: number;
  embedding: number[];
  embeddingModel: string;
}

export interface ConversationDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  // the author: the only person who can add to it, rename it, share it or delete it
  userId: ObjectId;
  title: string;
  visibility: ConversationVisibility;
  createdAt: Date;
  // bumped by every message, so the history lists the live conversations first
  updatedAt: Date;
}

export interface MessageDoc {
  _id: ObjectId;
  conversationId: ObjectId;
  // repeated from the conversation so a message can be found or removed by workspace alone
  workspaceId: ObjectId;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  error: string | null;
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number } | null;
  // in dollars; null when the model's price is not known
  costUsd: number | null;
  latency: { retrievalMs: number; ttftMs: number | null; totalMs: number } | null;
  // which model wrote it, for the cost and quality numbers in week 5
  model: string | null;
  createdAt: Date;
}

export interface ToolCallDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  conversationId: ObjectId;
  // the answer that asked for it
  messageId: ObjectId;
  tool: string;
  args: Record<string, unknown>;
  // one line saying what approving it will do, written when it was proposed
  description: string;
  status: ToolCallStatus;
  // whose conversation it came from: the person the assistant was working for
  proposedBy: ObjectId;
  decidedBy: ObjectId | null;
  decidedAt: Date | null;
  result: { summary: string; documentId?: string } | null;
  error: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export type EvalRunDoc = EvalRun & { _id: ObjectId };

export interface Database {
  client: MongoClient;
  db: Db;
  users: Collection<UserDoc>;
  workspaces: Collection<WorkspaceDoc>;
  memberships: Collection<MembershipDoc>;
  documents: Collection<DocumentDoc>;
  chunks: Collection<ChunkDoc>;
  conversations: Collection<ConversationDoc>;
  messages: Collection<MessageDoc>;
  toolCalls: Collection<ToolCallDoc>;
  evalRuns: Collection<EvalRunDoc>;
}

export async function connect(uri: string): Promise<Database> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  return {
    client,
    db,
    users: db.collection('users'),
    workspaces: db.collection('workspaces'),
    memberships: db.collection('memberships'),
    documents: db.collection('documents'),
    chunks: db.collection('chunks'),
    conversations: db.collection('conversations'),
    messages: db.collection('messages'),
    toolCalls: db.collection('tool_calls'),
    evalRuns: db.collection('eval_runs'),
  };
}

// Every field the API filters or sorts on is indexed. The comments say which query each index serves.
export async function ensureIndexes(d: Database): Promise<void> {
  await Promise.all([
    // sign in, and "add this person to my workspace". Guests have no email, so the index skips them.
    d.users.createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    ),

    // the access check on every request: is this user in this workspace, and as what
    d.memberships.createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
    // "my workspaces"
    d.memberships.createIndex({ userId: 1, createdAt: 1 }),
    // the member list: one workspace's people, oldest first
    d.memberships.createIndex({ workspaceId: 1, createdAt: 1 }),

    // the document library: one workspace's files, newest first
    d.documents.createIndex({ workspaceId: 1, createdAt: -1, _id: -1 }),
    // the sweep that re-queues documents whose job was lost
    d.documents.createIndex({ status: 1, updatedAt: 1 }),

    // a document's chunks in reading order, and removing them all when it is deleted or re-processed
    d.chunks.createIndex({ documentId: 1, ord: 1 }, { unique: true }),

    // the history: this person's conversations, and the ones shared with the workspace, newest first
    d.conversations.createIndex({ workspaceId: 1, userId: 1, updatedAt: -1, _id: -1 }),
    d.conversations.createIndex({ workspaceId: 1, visibility: 1, updatedAt: -1, _id: -1 }),
    d.conversations.createIndex({ workspaceId: 1, title: 'text' }),

    // a conversation's messages in order, and searching what was said inside one workspace
    d.messages.createIndex({ conversationId: 1, createdAt: 1, _id: 1 }),
    d.messages.createIndex({ workspaceId: 1, content: 'text' }),
    // at most one answer is being written per conversation: the database refuses a second one
    d.messages.createIndex(
      { conversationId: 1 },
      {
        unique: true,
        partialFilterExpression: { status: 'streaming' },
        name: 'one_streaming_answer',
      },
    ),
    // the cards in a conversation, and the audit trail: every call the assistant asked for, newest first
    d.toolCalls.createIndex({ conversationId: 1, createdAt: 1, _id: 1 }),
    d.toolCalls.createIndex({ workspaceId: 1, createdAt: -1, _id: -1 }),
    d.toolCalls.createIndex({ workspaceId: 1, proposedBy: 1, createdAt: -1, _id: -1 }),

    // the dashboard: evaluation runs, newest first
    d.evalRuns.createIndex({ createdAt: -1 }),

    // the sweep that fails answers whose writer died
    d.messages.createIndex(
      { status: 1, createdAt: 1 },
      { partialFilterExpression: { status: 'streaming' } },
    ),
  ]);

  // These served the same queries before their sorts gained an `_id` tie-break, and now only cost writes. A
  // database made earlier still has them; one made now never did.
  const obsolete: [{ dropIndex(name: string): Promise<unknown> }, string][] = [
    [d.conversations, 'workspaceId_1_userId_1_updatedAt_-1'],
    [d.conversations, 'workspaceId_1_visibility_1_updatedAt_-1'],
    [d.toolCalls, 'conversationId_1_createdAt_1'],
    [d.toolCalls, 'workspaceId_1_createdAt_-1'],
    [d.toolCalls, 'workspaceId_1_proposedBy_1_createdAt_-1'],
  ];
  for (const [collection, name] of obsolete)
    await collection.dropIndex(name).catch(() => undefined);
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
