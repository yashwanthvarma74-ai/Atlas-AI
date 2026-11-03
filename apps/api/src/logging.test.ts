import { Writable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCore, type TestCore } from '@atlas/core/test';
import { createApp } from './app';

let core: TestCore;
beforeAll(async () => {
  core = await createTestCore();
});
afterAll(() => core.destroy());

describe('request logs', () => {
  it('never contain the session cookie', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = createApp(core, pino({ level: 'info' }, sink));

    await request(app)
      .get('/auth/me')
      .set('Cookie', 'atlas_session=secret-token-value')
      .expect(401);

    const logged = lines.join('');
    expect(logged).toContain('/auth/me');
    expect(logged).not.toContain('secret-token-value');
  });
});
