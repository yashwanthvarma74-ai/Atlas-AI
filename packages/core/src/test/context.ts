import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { pino } from 'pino';
import type { Role } from '@atlas/shared';
import { requireAccess, type WorkspaceAccess } from '../access';
import { loadConfig } from '../config';
import { createCore, type Core, type CoreOptions } from '../core';
import type { UserDoc } from '../db';
import { createWorkspace } from '../workspaces';

const MONGO_URL = process.env.MONGODB_TEST_URL ?? 'mongodb://127.0.0.1:27017';
const REDIS_URL = process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379';

export interface TestCore extends Core {
  // removes the database, the queue and the upload folder this test made
  destroy(): Promise<void>;
  user(email: string, fields?: Partial<UserDoc>): Promise<UserDoc>;
  // a new workspace owned by `owner`, with the proof of that ownership
  workspace(owner: UserDoc): Promise<WorkspaceAccess>;
  // `user`'s access to a workspace they were added to
  accessFor(user: UserDoc, workspace: WorkspaceAccess, minimum?: Role): Promise<WorkspaceAccess>;
}

// Each test file gets its own MongoDB database, its own Redis key prefix and its own upload folder on
// the local servers, and removes them afterwards.
export async function createTestCore(
  overrides: Record<string, string> = {},
  options: CoreOptions = {},
  mongoUrl = MONGO_URL,
): Promise<TestCore> {
  const suffix = randomBytes(6).toString('hex');
  const uploadDir = await mkdtemp(join(tmpdir(), 'atlas-uploads-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    // directConnection: Atlas Local is a replica set whose members advertise names only it can resolve
    MONGODB_URI: `${mongoUrl}/atlas_test_${suffix}?directConnection=true`,
    REDIS_URL,
    REDIS_PREFIX: `atlas_test_${suffix}`,
    UPLOAD_DIR: uploadDir,
    INGEST_BACKOFF_MS: '50',
    ...overrides,
  });
  const core = await createCore(config, { logger: pino({ level: 'silent' }), ...options });

  return {
    ...core,
    async destroy() {
      await core.database.db.dropDatabase();
      await core.queues.ingest.obliterate({ force: true }).catch(() => undefined);
      await core.close();
      await rm(uploadDir, { recursive: true, force: true });
    },
    // Inserted directly, without a password hash: most tests only need someone to exist.
    async user(email, fields = {}) {
      const user: UserDoc = {
        _id: new ObjectId(),
        name: email.split('@')[0] ?? email,
        email,
        guest: false,
        createdAt: new Date(),
        ...fields,
      };
      await core.database.users.insertOne(user);
      return user;
    },
    async workspace(owner) {
      const workspace = await createWorkspace(core, owner, { name: 'Test workspace' });
      return requireAccess(core, owner._id, new ObjectId(workspace.id), 'owner');
    },
    async accessFor(user, workspace, minimum = 'viewer') {
      return requireAccess(core, user._id, workspace.workspaceId, minimum);
    },
  };
}
