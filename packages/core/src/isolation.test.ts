import { ObjectId } from 'mongodb';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keywordSearch, retrieve, vectorSearch, type WorkspaceAccess } from './index';
import type { TestCore } from './test/context';
import { createSearchTestCore, indexText, waitForIndexes, SEARCH_TEST_URL } from './test/search';

// The tenant-isolation suite. Two workspaces hold overlapping text on purpose, so a missing filter has
// something to leak, and the second one holds a secret the first must never see. Every attack below goes
// through retrieve(), the only way text reaches a model.
describe.skipIf(!SEARCH_TEST_URL)('tenant isolation', () => {
  let core: TestCore;
  let acme: WorkspaceAccess;
  let globex: WorkspaceAccess;
  const acmeDocs = new Set<string>();
  const globexDocs = new Set<string>();

  const SHARED = 'The quarterly revenue report shows growth in every region this year.';
  const SECRET = 'Project ZEBRA-7731 acquisition price is forty million dollars.';

  beforeAll(async () => {
    core = await createSearchTestCore();
    acme = await core.workspace(await core.user('owner@acme.test'));
    globex = await core.workspace(await core.user('owner@globex.test'));

    acmeDocs.add((await indexText(core, acme, 'acme-report.txt', SHARED)).toHexString());
    acmeDocs.add(
      (
        await indexText(core, acme, 'acme-notes.txt', 'Acme plans a picnic on Friday.')
      ).toHexString(),
    );
    globexDocs.add((await indexText(core, globex, 'globex-report.txt', SHARED)).toHexString());
    globexDocs.add((await indexText(core, globex, 'globex-secret.txt', SECRET)).toHexString());

    await waitForIndexes(core, acme);
    await waitForIndexes(core, globex);
  }, 90_000);
  afterAll(() => core.destroy());

  const idsOf = async (access: WorkspaceAccess, question: string, options = {}) =>
    (await retrieve(core, access, question, options)).map((s) => s.documentId);

  it('shows each workspace only its own copy of identical text', async () => {
    const [mine, theirs] = await Promise.all([
      idsOf(acme, 'quarterly revenue report'),
      idsOf(globex, 'quarterly revenue report'),
    ]);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.every((id) => acmeDocs.has(id))).toBe(true);
    expect(theirs.every((id) => globexDocs.has(id))).toBe(true);
  });

  it('never returns the other workspace secret, whether asked by meaning, by exact words, or by its code', async () => {
    for (const question of [
      'what is the acquisition price',
      'forty million dollars',
      'ZEBRA-7731',
      'zebra 7731 project acquisition',
    ]) {
      const sources = await retrieve(core, acme, question);
      expect(sources.map((s) => s.text).join(' ')).not.toMatch(/ZEBRA|forty million/);
    }
    // while the owner of the secret does find it, so the questions above are not empty by accident
    expect((await retrieve(core, globex, 'ZEBRA-7731'))[0]?.text).toContain('ZEBRA-7731');
  });

  it('cannot be widened by naming the other workspace documents', async () => {
    const theirs = [...globexDocs].map((id) => new ObjectId(id));
    const sources = await retrieve(core, acme, 'acquisition price quarterly revenue', {
      documentIds: theirs,
    });
    expect(sources).toEqual([]);

    // mixing one of its own with one of theirs yields only its own
    const mixed = await idsOf(acme, 'quarterly revenue report', {
      documentIds: [...theirs, new ObjectId([...acmeDocs][0]!)],
    });
    expect(mixed.every((id) => acmeDocs.has(id))).toBe(true);
  });

  // Each search stage must hold the line by itself. Seeing past retrieve()'s final name lookup, which
  // would also drop a leaked chunk, is what makes these the real test of the filters.
  describe('each search stage on its own', () => {
    const SECRET_QUESTIONS = [
      'ZEBRA-7731 acquisition price',
      'quarterly revenue report',
      'forty million dollars',
    ];
    const owned = (docs: Set<string>, hits: { documentId: ObjectId }[]) =>
      hits.every((hit) => docs.has(hit.documentId.toHexString()));

    it('vector search returns only the caller workspace, including the secret query', async () => {
      for (const question of SECRET_QUESTIONS) {
        const [vector] = await core.embedder.embed([question]);
        const hits = await vectorSearch(core, acme, vector!, 30);
        expect(owned(acmeDocs, hits)).toBe(true);
        expect((await vectorSearch(core, globex, vector!, 30)).length).toBeGreaterThan(0);
      }
    });

    it('keyword search returns only the caller workspace, including the secret query', async () => {
      for (const question of SECRET_QUESTIONS) {
        const hits = await keywordSearch(core, acme, question, 30);
        expect(owned(acmeDocs, hits)).toBe(true);
      }
      expect((await keywordSearch(core, globex, 'ZEBRA-7731', 30)).length).toBeGreaterThan(0);
    });

    it('a document filter narrows the workspace and never replaces it', async () => {
      const theirs = [...globexDocs].map((id) => new ObjectId(id));
      const [vector] = await core.embedder.embed(['ZEBRA-7731 acquisition price']);

      expect(await vectorSearch(core, acme, vector!, 30, theirs)).toEqual([]);
      expect(await keywordSearch(core, acme, 'ZEBRA-7731 acquisition price', 30, theirs)).toEqual(
        [],
      );
    });
  });

  it('treats a question that looks like a query operator, an id or an injection as plain words', async () => {
    const attacks = [
      '{"$ne": null}',
      '{ $or: [{ workspaceId: { $exists: true } }] }',
      `workspaceId: ${globex.workspaceId.toHexString()}`,
      globex.workspaceId.toHexString(),
      '" OR 1=1 --',
      "'; db.chunks.find({}) //",
      '*',
      '\u0000',
      'a'.repeat(400),
    ];
    for (const attack of attacks) {
      const ids = await idsOf(acme, attack);
      expect(ids.every((id) => acmeDocs.has(id))).toBe(true);
    }
  });

  it('holds for any question and any limit, in either direction', async () => {
    const vocabulary = [
      'revenue',
      'report',
      'quarterly',
      'growth',
      'region',
      'picnic',
      'friday',
      'ZEBRA-7731',
      'acquisition',
      'price',
      'million',
      'secret',
      'forty',
      'project',
    ];
    const question = fc
      .array(fc.constantFrom(...vocabulary), { minLength: 1, maxLength: 6 })
      .map((words) => words.join(' '));

    await fc.assert(
      fc.asyncProperty(question, fc.integer({ min: 1, max: 12 }), async (text, limit) => {
        const fromAcme = await idsOf(acme, text, { limit });
        const fromGlobex = await idsOf(globex, text, { limit });
        expect(fromAcme.every((id) => acmeDocs.has(id))).toBe(true);
        expect(fromGlobex.every((id) => globexDocs.has(id))).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('stops serving a workspace to someone who left it', async () => {
    // access is a fresh proof per request: a removed member cannot obtain one to pass to retrieve()
    const { removeMember, addMember, requireAccess } = await import('./index');
    const guest = await core.user('guest@acme.test');
    await addMember(core, acme, { email: 'guest@acme.test', role: 'viewer' });
    const guestAccess = await requireAccess(core, guest._id, acme.workspaceId);
    expect((await retrieve(core, guestAccess, 'picnic')).length).toBeGreaterThan(0);

    await removeMember(core, acme, guest._id);
    await expect(requireAccess(core, guest._id, acme.workspaceId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
