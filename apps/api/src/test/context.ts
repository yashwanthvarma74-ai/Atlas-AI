import { pino } from 'pino';
import request from 'supertest';
import { createTestCore, type TestCore } from '@atlas/core/test';
import { createApp } from '../app';

export type Client = ReturnType<typeof request.agent>;

export interface TestApp {
  core: TestCore;
  // one-off requests, with no cookies
  anonymous(): ReturnType<typeof request>;
  // a browser: remembers the session cookie between requests
  browser(): Client;
  // a browser that has just registered a new account
  signUp(email: string, name?: string): Promise<Client>;
  destroy(): Promise<void>;
}

const PASSWORD = 'a long enough password';

// `core` lets a suite bring its own, for example one on a database that has Atlas Search.
export async function createTestApp(core?: TestCore): Promise<TestApp> {
  core ??= await createTestCore();
  const app = createApp(core, pino({ level: 'silent' }));

  const browser = () => request.agent(app);

  return {
    core,
    anonymous: () => request(app),
    browser,
    async signUp(email, name = email.split('@')[0]!) {
      const client = browser();
      await client.post('/auth/register').send({ name, email, password: PASSWORD }).expect(201);
      return client;
    },
    destroy: () => core.destroy(),
  };
}
