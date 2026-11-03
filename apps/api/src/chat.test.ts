import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSse, type ChatStreamEvent, type Message } from '@atlas/shared';
import { processDocument, requireAccess } from '@atlas/core';
import { createTestCore } from '@atlas/core/test';
import { createSearchTestCore, waitForIndexes, SEARCH_TEST_URL } from '@atlas/core/test/search';
import { createTestApp, type Client, type TestApp } from './test/context';

const NOTES = 'Revenue grew 14 percent in the third quarter, driven by new regions in Asia.';

// A stream the test has already received in full, read back into events.
async function eventsOf(text: string): Promise<ChatStreamEvent[]> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const events: ChatStreamEvent[] = [];
  for await (const frame of parseSse(body)) events.push(JSON.parse(frame.data));
  return events;
}

// Posts to a streaming endpoint and returns the response with its events.
async function stream(client: Client, path: string, body?: object) {
  const res = await client
    .post(path)
    .send(body)
    .buffer(true)
    .parse((response, done) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => done(null, data));
    });
  return { res, events: res.status === 200 ? await eventsOf(res.body as string) : [] };
}

const done = (events: ChatStreamEvent[]) =>
  events.find((e): e is Extract<ChatStreamEvent, { type: 'done' }> => e.type === 'done')!.message;

async function workspaceWith(owner: Client): Promise<string> {
  return (await owner.post('/workspaces').send({ name: 'Research' }).expect(201)).body.workspace.id;
}
const startConversation = async (client: Client, ws: string): Promise<string> =>
  (await client.post(`/workspaces/${ws}/conversations`).expect(201)).body.conversation.id;

describe('conversations over HTTP', () => {
  let t: TestApp;
  beforeAll(async () => {
    // whatever the test database is, behave as if it had no search service
    t = await createTestApp({
      ...(await createTestCore()),
      searchAvailable: false,
      recheckSearch: async () => false,
    });
  });
  afterAll(() => t.destroy());

  async function team() {
    const tag = Math.random().toString(36).slice(2);
    const owner = await t.signUp(`olivia${tag}@chat.test`);
    const viewer = await t.signUp(`vera${tag}@chat.test`);
    const ws = await workspaceWith(owner);
    await owner
      .post(`/workspaces/${ws}/members`)
      .send({ email: `vera${tag}@chat.test`, role: 'viewer' })
      .expect(201);
    return { owner, viewer, ws };
  }

  it('needs a signed-in user', async () => {
    const { ws } = await team();
    await t.anonymous().get(`/workspaces/${ws}/conversations`).expect(401);
    await t
      .anonymous()
      .post(`/workspaces/${ws}/conversations/0123456789abcdef01234567/messages`)
      .send({ content: 'hi' })
      .expect(401);
  });

  it('creates, lists, renames and deletes a conversation', async () => {
    const { owner, ws } = await team();
    const id = await startConversation(owner, ws);

    const list = await owner.get(`/workspaces/${ws}/conversations`).expect(200);
    expect(list.body.conversations).toEqual([
      expect.objectContaining({ id, title: 'New conversation', visibility: 'private', mine: true }),
    ]);

    const renamed = await owner
      .patch(`/workspaces/${ws}/conversations/${id}`)
      .send({ title: 'Board prep' })
      .expect(200);
    expect(renamed.body.conversation.title).toBe('Board prep');

    await owner.delete(`/workspaces/${ws}/conversations/${id}`).expect(204);
    await owner.get(`/workspaces/${ws}/conversations/${id}`).expect(404);
  });

  it('rejects an empty change and a title that is blank', async () => {
    const { owner, ws } = await team();
    const id = await startConversation(owner, ws);
    await owner.patch(`/workspaces/${ws}/conversations/${id}`).send({}).expect(400);
    await owner.patch(`/workspaces/${ws}/conversations/${id}`).send({ title: '   ' }).expect(400);
    await owner
      .patch(`/workspaces/${ws}/conversations/${id}`)
      .send({ visibility: 'public' })
      .expect(400);
  });

  it('keeps a conversation private until its author shares it, and then lets others read but not write', async () => {
    const { owner, viewer, ws } = await team();
    const id = await startConversation(owner, ws);
    const path = `/workspaces/${ws}/conversations/${id}`;

    const hidden = await viewer.get(path).expect(404);
    const missing = await viewer
      .get(`/workspaces/${ws}/conversations/0123456789abcdef01234567`)
      .expect(404);
    expect(hidden.body).toEqual(missing.body);
    expect(
      (await viewer.get(`/workspaces/${ws}/conversations`).expect(200)).body.conversations,
    ).toEqual([]);

    await owner.patch(path).send({ visibility: 'workspace' }).expect(200);
    const shared = await viewer.get(path).expect(200);
    expect(shared.body.conversation).toMatchObject({ mine: false, visibility: 'workspace' });

    await viewer.patch(path).send({ title: 'Mine now' }).expect(403);
    await viewer.delete(path).expect(403);
    await viewer.post(`${path}/messages`).send({ content: 'can I add to it?' }).expect(403);
  });

  it('answers an outsider as it answers a workspace that does not exist', async () => {
    const { owner, ws } = await team();
    const outsider = await t.signUp(`out${Math.random().toString(36).slice(2)}@chat.test`);
    const id = await startConversation(owner, ws);

    const real = await outsider.get(`/workspaces/${ws}/conversations/${id}`).expect(404);
    const none = await outsider
      .get('/workspaces/0123456789abcdef01234567/conversations/0123456789abcdef01234567')
      .expect(404);
    expect(real.body).toEqual(none.body);
    await outsider.post(`/workspaces/${ws}/conversations`).expect(404);
  });

  it('rejects an empty question and one over the limit before any stream starts', async () => {
    const { owner, ws } = await team();
    const id = await startConversation(owner, ws);
    const path = `/workspaces/${ws}/conversations/${id}/messages`;
    expect(
      (await owner.post(path).send({ content: '   ' }).expect(400)).headers['content-type'],
    ).toContain('application/json');
    await owner
      .post(path)
      .send({ content: 'x'.repeat(501) })
      .expect(400);
    await owner.post(path).send({}).expect(400);
  });

  it('streams events, and says when search is not available, as a failed answer', async () => {
    const { viewer, ws } = await team();
    // a viewer may ask questions in a conversation of their own
    const id = await startConversation(viewer, ws);
    const { res, events } = await stream(viewer, `/workspaces/${ws}/conversations/${id}/messages`, {
      content: 'How did revenue grow?',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-transform');
    expect(events.map((e) => e.type)).toEqual(['start', 'done']);
    expect(done(events)).toMatchObject({
      role: 'assistant',
      status: 'failed',
      error: expect.stringMatching(/Search is not available/),
    });

    // and it was saved, with the question, for next time
    const saved = await viewer.get(`/workspaces/${ws}/conversations/${id}`).expect(200);
    expect(saved.body.messages.map((m: Message) => [m.role, m.status])).toEqual([
      ['user', 'complete'],
      ['assistant', 'failed'],
    ]);
    expect(saved.body.conversation.title).toBe('How did revenue grow?');
  });

  it('refuses a second answer while one is being written, as an ordinary 409', async () => {
    const { owner, ws } = await team();
    const id = await startConversation(owner, ws);
    await t.core.database.messages.insertOne({
      _id: new ObjectId(),
      conversationId: new ObjectId(id),
      workspaceId: new ObjectId(ws),
      role: 'assistant',
      content: '',
      status: 'streaming',
      error: null,
      citations: [],
      usage: null,
      costUsd: null,
      latency: null,
      model: null,
      createdAt: new Date(),
    });

    const { res } = await stream(owner, `/workspaces/${ws}/conversations/${id}/messages`, {
      content: 'another?',
    });
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('has nothing to write again in an empty conversation', async () => {
    const { owner, ws } = await team();
    const id = await startConversation(owner, ws);
    const { res } = await stream(owner, `/workspaces/${ws}/conversations/${id}/regenerate`);
    expect(res.status).toBe(400);
  });

  it('finds a conversation by what was said in it, for its author and for nobody else', async () => {
    const { owner, viewer, ws } = await team();
    const id = await startConversation(owner, ws);
    await stream(owner, `/workspaces/${ws}/conversations/${id}/messages`, {
      content: 'Tell me about the zeppelin budget',
    });

    const mine = await owner
      .get(`/workspaces/${ws}/conversations`)
      .query({ q: 'zeppelin' })
      .expect(200);
    expect(mine.body.conversations.map((c: { id: string }) => c.id)).toEqual([id]);
    const theirs = await viewer
      .get(`/workspaces/${ws}/conversations`)
      .query({ q: 'zeppelin' })
      .expect(200);
    expect(theirs.body.conversations).toEqual([]);
  });
});

describe.skipIf(!SEARCH_TEST_URL)('chat with search', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp(await createSearchTestCore());
  }, 150_000);
  afterAll(() => t.destroy());

  async function indexed(text = NOTES) {
    const owner = await t.signUp(`owner${Math.random().toString(36).slice(2)}@chat.test`);
    const ws = await workspaceWith(owner);
    const doc = (
      await owner
        .post(`/workspaces/${ws}/documents`)
        .query({ name: 'annual-report.txt' })
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(text))
        .expect(202)
    ).body.document;
    const me = (await owner.get('/auth/me')).body.user.id;
    await processDocument(t.core, { documentId: doc.id, workspaceId: ws, userId: me });
    await waitForIndexes(t.core, await requireAccess(t.core, new ObjectId(me), new ObjectId(ws)));
    return { owner, ws, docId: doc.id as string };
  }

  it('answers from the document with a citation that points back to it', async () => {
    const { owner, ws, docId } = await indexed();
    const id = await startConversation(owner, ws);
    const { events } = await stream(owner, `/workspaces/${ws}/conversations/${id}/messages`, {
      content: 'how did revenue grow in the third quarter?',
    });

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['start', 'sources', 'token', 'done']),
    );
    expect(events.at(-1)?.type).toBe('done');
    const message = done(events);
    expect(message).toMatchObject({ status: 'complete', error: null });
    expect(message.content).toContain('Revenue grew 14 percent');
    expect(message.citations).toEqual([
      expect.objectContaining({
        n: 1,
        documentId: docId,
        documentName: 'annual-report.txt',
        page: 1,
      }),
    ]);
    expect(message.latency?.ttftMs).toBeGreaterThanOrEqual(0);

    // the words that streamed are the words that were saved
    const streamed = events.flatMap((e) => (e.type === 'token' ? [e.text] : [])).join('');
    expect(streamed).toBe(message.content);
  });

  it('says it found nothing in a workspace with no documents, without calling a model', async () => {
    const owner = await t.signUp(`empty${Math.random().toString(36).slice(2)}@chat.test`);
    const ws = await workspaceWith(owner);
    const id = await startConversation(owner, ws);
    const { events } = await stream(owner, `/workspaces/${ws}/conversations/${id}/messages`, {
      content: 'anything at all',
    });
    expect(done(events)).toMatchObject({
      status: 'complete',
      usage: null,
      content: expect.stringMatching(/could not find anything/),
    });
  });

  it('writes the last answer again and keeps one question', async () => {
    const { owner, ws } = await indexed();
    const id = await startConversation(owner, ws);
    await stream(owner, `/workspaces/${ws}/conversations/${id}/messages`, {
      content: 'revenue growth',
    });
    const { events } = await stream(owner, `/workspaces/${ws}/conversations/${id}/regenerate`);

    expect(done(events).status).toBe('complete');
    const saved = await owner.get(`/workspaces/${ws}/conversations/${id}`).expect(200);
    expect(saved.body.messages.map((m: Message) => m.role)).toEqual(['user', 'assistant']);
  });

  it('keeps the words that had arrived when the browser stops listening', async () => {
    // a slower model, so there is something to stop
    const slow = await createSearchTestCore({ EXTRACTIVE_DELAY_MS: '80' });
    const app = await createTestApp(slow);
    const server = await app.serve();
    try {
      const register = await app
        .anonymous()
        .post('/auth/register')
        .send({ name: 'Stopper', email: 'stop@chat.test', password: 'a long enough password' })
        .expect(201);
      const cookie = register.headers['set-cookie']![0]!.split(';')[0]!;
      const headers = { cookie, 'content-type': 'application/json' };
      const call = async <T>(path: string, init: RequestInit = {}) =>
        (await (await fetch(`${server.url}${path}`, { headers, ...init })).json()) as T;

      const { workspace } = await call<{ workspace: { id: string } }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'W' }),
      });
      const ws = workspace.id;
      const me = register.body.user.id;
      const { document } = await call<{ document: { id: string } }>(
        `/workspaces/${ws}/documents?name=n.txt`,
        {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/octet-stream' },
          body: `${NOTES} ${'More detail follows here about the quarter. '.repeat(3)}`,
        },
      );
      await processDocument(slow, { documentId: document.id, workspaceId: ws, userId: me });
      await waitForIndexes(slow, await requireAccess(slow, new ObjectId(me), new ObjectId(ws)));
      const { conversation } = await call<{ conversation: { id: string } }>(
        `/workspaces/${ws}/conversations`,
        {
          method: 'POST',
        },
      );

      const controller = new AbortController();
      const res = await fetch(
        `${server.url}/workspaces/${ws}/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ content: 'revenue growth in the third quarter' }),
          signal: controller.signal,
        },
      );
      let tokens = 0;
      try {
        for await (const frame of parseSse(res.body!)) {
          if (frame.event === 'token' && ++tokens === 3) controller.abort();
        }
      } catch {
        // the abort ends the read with an error, which is the point
      }
      expect(tokens).toBeGreaterThanOrEqual(3);

      // the server notices the closed connection, stops the model and saves what it has
      let saved: Message | undefined;
      for (let i = 0; i < 60 && saved?.status !== 'stopped'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const { messages } = await call<{ messages: Message[] }>(
          `/workspaces/${ws}/conversations/${conversation.id}`,
        );
        saved = messages.find((m) => m.role === 'assistant');
      }
      expect(saved?.status).toBe('stopped');
      expect(saved?.content.length).toBeGreaterThan(0);
    } finally {
      await server.close();
      await app.destroy();
    }
  }, 60_000);
});
