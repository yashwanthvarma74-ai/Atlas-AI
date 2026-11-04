import { pino } from 'pino';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import { createCore } from './core';
import { connect, ensureIndexes, type Database } from './db';
import { ObjectId } from 'mongodb';
import { uploadDocument } from './documents';
import {
  ensureSearchIndexes,
  rebuildVectorIndex,
  TEXT_INDEX,
  VECTOR_INDEX,
} from './search-indexes';
import type { TestCore } from './test/context';
import { createSearchTestCore, SEARCH_TEST_URL } from './test/search';

const logger = pino({ level: 'silent' });

describe('ensureSearchIndexes', () => {
  it('reports no search, instead of throwing, on a database that cannot do it', async () => {
    const plain = {
      chunks: {
        listSearchIndexes: () => ({
          toArray: async () => {
            throw new Error('Error connecting to Search Index Management service.');
          },
        }),
      },
    } as unknown as Database;

    expect(await ensureSearchIndexes(plain, 256, logger)).toBe(false);
  });

  describe.skipIf(!SEARCH_TEST_URL)('on Atlas Search', () => {
    let core: TestCore;
    beforeAll(async () => {
      core = await createSearchTestCore();
    }, 150_000);
    afterAll(() => core.destroy());

    it('creates both indexes, and running it again changes nothing', async () => {
      expect(await ensureSearchIndexes(core.database, 256, logger)).toBe(true);
      const names = (await core.database.chunks.listSearchIndexes().toArray()).map((i) => i.name);
      expect(names.sort()).toEqual([TEXT_INDEX, VECTOR_INDEX].sort());
    });

    it('lets several processes start together without any of them losing the race', async () => {
      // The API and the worker both start up and both find no indexes. One of them is told the name is taken,
      // which must read as "already done", not as "this database cannot search".
      const database = await connect(
        `${SEARCH_TEST_URL}/atlas_race_${randomBytes(4).toString('hex')}?directConnection=true`,
      );
      try {
        // as the app does first, which also creates the collection the search indexes belong to
        await ensureIndexes(database);
        const results = await Promise.all(
          Array.from({ length: 5 }, () => ensureSearchIndexes(database, 256, logger)),
        );

        expect(results).toEqual([true, true, true, true, true]);
        const names = (await database.chunks.listSearchIndexes().toArray()).map((i) => i.name);
        expect(names.sort()).toEqual([TEXT_INDEX, VECTOR_INDEX].sort());
      } finally {
        await database.db.dropDatabase();
        await database.client.close();
      }
    });

    describe('when the search service comes up after the app', () => {
      afterEach(() => vi.useRealTimers());

      it('finds it on a later request, not only at start, and not more than every few seconds', async () => {
        const database = `atlas_late_${randomBytes(4).toString('hex')}`;
        const late = await createCore(
          loadConfig({
            NODE_ENV: 'test',
            MONGODB_URI: `${SEARCH_TEST_URL}/${database}?directConnection=true`,
            REDIS_PREFIX: `atlas_${database}`,
          }),
          { logger },
        );
        try {
          // as if search had been down when the app started
          late.searchAvailable = false;

          expect(await late.recheckSearch()).toBe(false);
          expect(late.searchAvailable).toBe(false);

          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(Date.now() + 11_000);
          expect(await late.recheckSearch()).toBe(true);
          expect(late.searchAvailable).toBe(true);
        } finally {
          vi.useRealTimers();
          await late.database.db.dropDatabase();
          await late.close();
        }
      }, 30_000);
    });

    it('stops, and says why, when the configured size no longer matches the index', async () => {
      await expect(ensureSearchIndexes(core.database, 768, logger)).rejects.toThrow(
        /256-dimensional.*EMBEDDING_DIMENSIONS is 768.*re-processing every document/,
      );
    });

    it('rebuilds the index for a new size when allowed, and queues the documents to embed again', async () => {
      const ws = await core.workspace(await core.user('rebuild@search.test'));
      const doc = await uploadDocument(core, ws, {
        name: 'a.txt',
        bytes: new TextEncoder().encode('Hello there.'),
      });
      await core.database.chunks.insertOne({
        _id: new ObjectId(),
        workspaceId: ws.workspaceId,
        documentId: new ObjectId(doc.id),
        ord: 0,
        page: 1,
        text: 'Hello there.',
        tokenCount: 3,
        embedding: Array.from({ length: 256 }, () => 0.1),
        embeddingModel: 'feature-hashing',
      });
      await core.database.documents.updateOne(
        { _id: new ObjectId(doc.id) },
        { $set: { status: 'indexed' } },
      );

      const requeued = await rebuildVectorIndex(core.database, 'new-model', logger);
      expect(await ensureSearchIndexes(core.database, 384, logger)).toBe(true);

      const [vector] = (await core.database.chunks.listSearchIndexes(VECTOR_INDEX).toArray()) as {
        latestDefinition?: { fields?: { type: string; numDimensions?: number }[] };
      }[];
      expect(
        vector?.latestDefinition?.fields?.find((f) => f.type === 'vector')?.numDimensions,
      ).toBe(384);
      expect(requeued).toBe(1);
      expect(await core.database.chunks.countDocuments({ documentId: new ObjectId(doc.id) })).toBe(
        0,
      );
      const after = await core.database.documents.findOne({ _id: new ObjectId(doc.id) });
      expect(after?.status).toBe('queued');
      // old enough that the requeue sweep takes it on its next pass
      expect(after?.updatedAt.getTime()).toBe(0);
    }, 180_000);
  });
});
