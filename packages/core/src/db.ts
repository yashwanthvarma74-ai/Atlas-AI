import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { DocumentKind, DocumentStatus, Role } from '@atlas/shared';

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

export interface Database {
  client: MongoClient;
  db: Db;
  users: Collection<UserDoc>;
  workspaces: Collection<WorkspaceDoc>;
  memberships: Collection<MembershipDoc>;
  documents: Collection<DocumentDoc>;
  chunks: Collection<ChunkDoc>;
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

    // the document library: one workspace's files, newest first
    d.documents.createIndex({ workspaceId: 1, createdAt: -1, _id: -1 }),
    // the sweep that re-queues documents whose job was lost
    d.documents.createIndex({ status: 1, updatedAt: 1 }),

    // a document's chunks in reading order, and removing them all when it is deleted or re-processed
    d.chunks.createIndex({ documentId: 1, ord: 1 }, { unique: true }),
  ]);
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
