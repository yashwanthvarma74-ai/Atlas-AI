import { ObjectId } from 'mongodb';
import type { WorkspaceAccess } from '../access';
import { uploadDocument } from '../documents';
import { processDocument } from '../ingest';
import { TEXT_INDEX, VECTOR_INDEX } from '../search-indexes';
import { createTestCore, type TestCore } from './context';

// Search tests need a database with Atlas Search next to it: Atlas Local, or an Atlas cluster. Point this at
// one, for example  SEARCH_TEST_URL='mongodb://127.0.0.1:27018'  with the mongodb-atlas-local image
// started as in docker-compose.yml. Without it these tests are skipped, never faked.
export const SEARCH_TEST_URL = process.env.SEARCH_TEST_URL;

export async function createSearchTestCore(
  overrides: Record<string, string> = {},
  options: Parameters<typeof createTestCore>[1] = {},
): Promise<TestCore> {
  // A freshly started Atlas Local answers queries before its search service is up, so the first attempts
  // can find no search. Wait for it, for up to two minutes, instead of failing a cold start.
  const deadline = Date.now() + 120_000;
  for (;;) {
    // the same server as MONGODB_TEST_URL in CI, and a separate one on a laptop that also has a plain mongod
    const core = await createTestCore({ ...overrides }, { ...options }, SEARCH_TEST_URL);
    if (core.searchAvailable) return core;
    await core.destroy();
    if (Date.now() > deadline) throw new Error(`No Atlas Search at ${SEARCH_TEST_URL}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

// Runs `check` until it stops throwing. Atlas Search indexes documents a moment after they are written,
// so a test that reads straight after a write has to wait for the index, not guess how long.
export async function eventually<T>(check: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

// Uploads a text file and runs it through the whole ingest pipeline, returning the document's id.
export async function indexText(
  core: TestCore,
  access: WorkspaceAccess,
  name: string,
  text: string,
): Promise<ObjectId> {
  const doc = await uploadDocument(core, access, { name, bytes: new TextEncoder().encode(text) });
  await processDocument(core, {
    documentId: doc.id,
    workspaceId: access.workspaceId.toHexString(),
    userId: access.userId.toHexString(),
  });
  return new ObjectId(doc.id);
}

// Waits until both search indexes hold every chunk the workspace has in the database. They sync on
// their own schedules, and a test that reads while one is behind sees a different ranking, not an error.
export async function waitForIndexes(core: TestCore, access: WorkspaceAccess): Promise<void> {
  const { workspaceId } = access;
  await eventually(async () => {
    const expected = await core.database.chunks.countDocuments({ workspaceId });

    // any direction will do: with limit and numCandidates above the chunk count, it returns every chunk
    // the vector index holds for this workspace
    const [vector] = await core.embedder.embed(['count']);
    const inVectorIndex = await core.database.chunks
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: 'embedding',
            queryVector: vector!.some((x) => x !== 0) ? vector : [1, ...vector!.slice(1)],
            numCandidates: Math.max(expected * 10, 100),
            limit: Math.max(expected, 1),
            filter: { workspaceId },
          },
        },
        { $count: 'n' },
      ])
      .toArray();
    const inTextIndex = await core.database.chunks
      .aggregate([
        {
          $searchMeta: {
            index: TEXT_INDEX,
            count: { type: 'total' },
            equals: { path: 'workspaceId', value: workspaceId },
          },
        },
      ])
      .toArray();

    const vectors = (inVectorIndex[0]?.n as number | undefined) ?? 0;
    const texts = (inTextIndex[0]?.count?.total as number | undefined) ?? 0;
    if (vectors !== expected || texts !== expected) {
      throw new Error(`indexes hold ${vectors} and ${texts} of ${expected} chunks`);
    }
  });
}
