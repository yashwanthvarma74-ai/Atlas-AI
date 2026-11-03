import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { Role } from '@atlas/shared';

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

export interface Database {
  client: MongoClient;
  db: Db;
  users: Collection<UserDoc>;
  workspaces: Collection<WorkspaceDoc>;
  memberships: Collection<MembershipDoc>;
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
  ]);
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
