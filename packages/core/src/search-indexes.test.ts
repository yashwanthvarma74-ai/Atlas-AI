import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { ensureSearchIndexes, TEXT_INDEX, VECTOR_INDEX } from './search-indexes';
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

    it('stops, and says why, when the configured size no longer matches the index', async () => {
      await expect(ensureSearchIndexes(core.database, 768, logger)).rejects.toThrow(
        /256-dimensional.*EMBEDDING_DIMENSIONS is 768.*re-processing every document/,
      );
    });
  });
});
