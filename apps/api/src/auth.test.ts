import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession, SESSION_COOKIE } from './auth/session';
import { createTestApp, type TestApp } from './test/context';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.destroy());

const ada = { name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' };

describe('registration', () => {
  it('creates the account, signs the user in and sets an HttpOnly cookie', async () => {
    const res = await t.anonymous().post('/auth/register').send(ada).expect(201);

    expect(res.body.user).toMatchObject({ name: 'Ada', email: 'ada@example.com', guest: false });
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('never sends the password or its hash back', async () => {
    const res = await t
      .anonymous()
      .post('/auth/register')
      .send({ ...ada, email: 'leak@example.com' })
      .expect(201);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|scrypt/i);
  });

  it('refuses a duplicate email with 409', async () => {
    await t.anonymous().post('/auth/register').send(ada).expect(409);
  });

  it('explains what is wrong with the input', async () => {
    const res = await t
      .anonymous()
      .post('/auth/register')
      .send({ ...ada, email: 'x@example.com', password: 'short' })
      .expect(400);
    expect(res.body.error.message).toMatch(/at least 10/);
  });

  it('ignores fields it was not asked for', async () => {
    const res = await t
      .anonymous()
      .post('/auth/register')
      .send({ ...ada, email: 'extra@example.com', guest: true, _id: 'abc' })
      .expect(201);
    expect(res.body.user.guest).toBe(false);
    expect(res.body.user.id).not.toBe('abc');
  });
});

describe('login', () => {
  it('signs in with the right password and reaches /auth/me', async () => {
    const browser = t.browser();
    await browser
      .post('/auth/login')
      .send({ email: ada.email, password: ada.password })
      .expect(200);
    const me = await browser.get('/auth/me').expect(200);
    expect(me.body.user.email).toBe(ada.email);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const wrong = await t
      .anonymous()
      .post('/auth/login')
      .send({ email: ada.email, password: 'wrong password' })
      .expect(401);
    const unknown = await t
      .anonymous()
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong password' })
      .expect(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('is case-insensitive about the email', async () => {
    await t
      .anonymous()
      .post('/auth/login')
      .send({ email: 'ADA@Example.com', password: ada.password })
      .expect(200);
  });
});

describe('sessions', () => {
  it('requires a session for /auth/me', async () => {
    await t.anonymous().get('/auth/me').expect(401);
  });

  it('lets a guest in with one request and gives them a workspace', async () => {
    const browser = t.browser();
    const res = await browser.post('/auth/guest').expect(201);
    expect(res.body.user).toMatchObject({ guest: true, email: null });

    const workspaces = await browser.get('/workspaces').expect(200);
    expect(workspaces.body.workspaces).toHaveLength(1);
  });

  it('rejects a cookie signed with another secret', async () => {
    const forged = await signSession('0123456789abcdef01234567', 'x'.repeat(40));
    await t.anonymous().get('/auth/me').set('Cookie', `${SESSION_COOKIE}=${forged}`).expect(401);
  });

  it('rejects a valid cookie once the account is gone', async () => {
    const client = await t.signUp('gone@example.com');
    await client.get('/auth/me').expect(200);
    await t.core.database.users.deleteOne({ email: 'gone@example.com' });
    await client.get('/auth/me').expect(401);
  });

  it('clears the cookie on logout', async () => {
    const res = await t.anonymous().post('/auth/logout').expect(204);
    expect(res.headers['set-cookie']?.[0]).toContain(`${SESSION_COOKIE}=;`);
  });
});

describe('cross-origin writes', () => {
  it('refuses a state change that names a foreign origin', async () => {
    await t.anonymous().post('/auth/guest').set('Origin', 'https://evil.example').expect(403);
  });

  it('accepts the web app origin, and requests that name none', async () => {
    await t.anonymous().post('/auth/guest').set('Origin', t.core.config.SITE_ORIGIN).expect(201);
    await t.anonymous().post('/auth/guest').expect(201);
  });

  it('does not restrict reads', async () => {
    await t.anonymous().get('/health').set('Origin', 'https://evil.example').expect(200);
  });
});

describe('errors', () => {
  it('answers an unknown route with the standard error body', async () => {
    const res = await t.anonymous().get('/nope').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('answers malformed JSON with 400 and no stack trace', async () => {
    const res = await t
      .anonymous()
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
  });

  it('reports a healthy database', async () => {
    const res = await t.anonymous().get('/health').expect(200);
    expect(res.body).toEqual({ ok: true, mongo: true });
  });
});
