import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { pino } from 'pino';
import { loadConfig } from '../config';
import { createCore, type Core } from '../core';
import type { UserDoc } from '../db';

const MONGO_URL = process.env.MONGODB_TEST_URL ?? 'mongodb://127.0.0.1:27017';

export interface TestCore extends Core {
  // removes the database this test made
  destroy(): Promise<void>;
  user(email: string, fields?: Partial<UserDoc>): Promise<UserDoc>;
}

// Each test file gets its own MongoDB database on the local server, and removes it afterwards.
export async function createTestCore(overrides: Record<string, string> = {}): Promise<TestCore> {
  const suffix = randomBytes(6).toString('hex');
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: `${MONGO_URL}/atlas_test_${suffix}`,
    ...overrides,
  });
  const core = await createCore(config, { logger: pino({ level: 'silent' }) });

  return {
    ...core,
    async destroy() {
      await core.database.db.dropDatabase();
      await core.close();
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
  };
}
