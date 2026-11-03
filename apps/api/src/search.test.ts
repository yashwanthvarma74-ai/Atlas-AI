import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processDocument, requireAccess } from '@atlas/core';
import { createTestCore } from '@atlas/core/test';
import { createSearchTestCore, waitForIndexes, SEARCH_TEST_URL } from '@atlas/core/test/search';
import { createTestApp, type Client, type TestApp } from './test/context';

const NOTES = 'Revenue grew 14 percent in the third quarter, driven by new regions in Asia.';

async function workspaceWith(owner: Client): Promise<string> {
  return (await owner.post('/workspaces').send({ name: 'Research' }).expect(201)).body.workspace.id;
}

async function uploadAndIndex(
  t: TestApp,
  owner: Client,
  workspaceId: string,
  text: string,
  name = 'notes.txt',
) {
  const res = await owner
    .post(`/workspaces/${workspaceId}/documents`)
    .query({ name })
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from(text))
    .expect(202);
  const doc = res.body.document;
  const me = (await owner.get('/auth/me').expect(200)).body.user.id;
  await processDocument(t.core, { documentId: doc.id, workspaceId, userId: me });
  return doc.id as string;
}

describe.skipIf(!SEARCH_TEST_URL)('search API', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp(await createSearchTestCore());
  }, 60_000);
  afterAll(() => t.destroy());

  async function seeded() {
    const owner = await t.signUp(`owner${Math.random().toString(36).slice(2)}@s.test`);
    const id = await workspaceWith(owner);
    const docId = await uploadAndIndex(t, owner, id, NOTES);

    // wait for the search index to take the passage in before the test asks for it
    const userId = new ObjectId((await owner.get('/auth/me')).body.user.id);
    await waitForIndexes(t.core, await requireAccess(t.core, userId, new ObjectId(id)));
    return { owner, id, docId };
  }

  it('finds the passage, numbered, with its document and page', async () => {
    const { owner, id, docId } = await seeded();
    const res = await owner
      .post(`/workspaces/${id}/search`)
      .send({ query: 'third quarter revenue' })
      .expect(200);

    expect(res.body.sources[0]).toMatchObject({
      n: 1,
      documentId: docId,
      documentName: 'notes.txt',
      page: 1,
    });
    expect(res.body.sources[0].text).toContain('Revenue grew');
  });

  it('lets a viewer search', async () => {
    const { owner, id } = await seeded();
    const viewer = await t.signUp(`viewer${Math.random().toString(36).slice(2)}@s.test`);
    const email = (await viewer.get('/auth/me')).body.user.email;
    await owner.post(`/workspaces/${id}/members`).send({ email, role: 'viewer' }).expect(201);

    const res = await viewer.post(`/workspaces/${id}/search`).send({ query: 'Asia' }).expect(200);
    expect(res.body.sources.length).toBeGreaterThan(0);
  });

  it('needs a signed-in user, and answers an outsider like a workspace that does not exist', async () => {
    const { owner, id } = await seeded();
    const outsider = await t.signUp(`out${Math.random().toString(36).slice(2)}@s.test`);

    await t.anonymous().post(`/workspaces/${id}/search`).send({ query: 'Asia' }).expect(401);
    const real = await outsider
      .post(`/workspaces/${id}/search`)
      .send({ query: 'Asia' })
      .expect(404);
    const none = await outsider
      .post('/workspaces/0123456789abcdef01234567/search')
      .send({ query: 'Asia' })
      .expect(404);
    expect(real.body).toEqual(none.body);
    await owner.post(`/workspaces/${id}/search`).send({ query: 'Asia' }).expect(200);
  });

  it('never returns another workspace passages, even when asked for its document ids', async () => {
    const mine = await seeded();
    const theirs = await seeded();

    const res = await mine.owner
      .post(`/workspaces/${mine.id}/search`)
      .send({ query: 'Asia revenue', documentIds: [theirs.docId] })
      .expect(200);
    expect(res.body.sources).toEqual([]);

    const own = await mine.owner
      .post(`/workspaces/${mine.id}/search`)
      .send({ query: 'Asia revenue' })
      .expect(200);
    expect(own.body.sources.every((s: { documentId: string }) => s.documentId === mine.docId)).toBe(
      true,
    );
  });

  it('rejects an empty query, an over-long one, and a bad document id', async () => {
    const { owner, id } = await seeded();
    await owner.post(`/workspaces/${id}/search`).send({ query: '   ' }).expect(400);
    await owner
      .post(`/workspaces/${id}/search`)
      .send({ query: 'x'.repeat(501) })
      .expect(400);
    await owner
      .post(`/workspaces/${id}/search`)
      .send({ query: 'Asia', documentIds: ['nope'] })
      .expect(400);
    await owner.post(`/workspaces/${id}/search`).send({}).expect(400);
  });

  it('returns the passages of a page for showing a citation in context', async () => {
    const { owner, id, docId } = await seeded();
    const res = await owner
      .get(`/workspaces/${id}/documents/${docId}/passages`)
      .query({ page: 1 })
      .expect(200);
    expect(res.body.passages).toHaveLength(1);
    expect(res.body.passages[0].text).toBe(NOTES);

    const empty = await owner
      .get(`/workspaces/${id}/documents/${docId}/passages`)
      .query({ page: 9 })
      .expect(200);
    expect(empty.body.passages).toEqual([]);
  });

  it('rejects a missing or invalid page, and does not read another workspace document', async () => {
    const mine = await seeded();
    const theirs = await seeded();
    const path = (ws: string, doc: string) => `/workspaces/${ws}/documents/${doc}/passages`;

    await mine.owner.get(path(mine.id, mine.docId)).expect(400);
    await mine.owner.get(path(mine.id, mine.docId)).query({ page: 'x' }).expect(400);
    await mine.owner.get(path(mine.id, mine.docId)).query({ page: 0 }).expect(400);
    await mine.owner.get(path(mine.id, theirs.docId)).query({ page: 1 }).expect(404);
  });
});

describe('search API without Atlas Search', () => {
  it('says so with 503 instead of failing', async () => {
    // whatever the test database is, behave as if it had no search service
    const t = await createTestApp({
      ...(await createTestCore()),
      searchAvailable: false,
      recheckSearch: async () => false,
    });
    try {
      const owner = await t.signUp('owner@plain.test');
      const id = await workspaceWith(owner);
      const res = await owner
        .post(`/workspaces/${id}/search`)
        .send({ query: 'anything' })
        .expect(503);
      expect(res.body.error.code).toBe('unavailable');
    } finally {
      await t.destroy();
    }
  });
});
