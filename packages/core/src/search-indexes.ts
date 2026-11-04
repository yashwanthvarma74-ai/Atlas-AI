import type { ObjectId } from 'mongodb';
import type { Logger } from 'pino';
import type { Core } from './core';
import type { Database } from './db';

// What listSearchIndexes returns beyond the name, which the driver's types leave out.
interface ExistingIndex {
  name: string;
  latestDefinition?: { fields?: { type: string; numDimensions?: number }[] };
}

// Two processes starting together (the API and the worker, or two replicas) both see "no index yet" and both
// create it. The slower one is told the name is taken, which means the job is done, not that it failed.
const isAlreadyThere = (error: unknown) =>
  /duplicate index|already exists/i.test(error instanceof Error ? error.message : String(error));

async function createIfMissing(
  database: Database,
  spec: Parameters<Database['chunks']['createSearchIndex']>[0],
): Promise<void> {
  try {
    await database.chunks.createSearchIndex(spec);
  } catch (error) {
    if (!isAlreadyThere(error)) throw error;
  }
}

export const VECTOR_INDEX = 'chunk_vectors';
export const TEXT_INDEX = 'chunk_text';

// workspaceId and documentId are declared as filter fields, which is what lets the tenant filter run
// inside the vector search itself instead of being applied to whatever it returned.
const vectorDefinition = (dimensions: number) => ({
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: dimensions, similarity: 'cosine' },
    { type: 'filter', path: 'workspaceId' },
    { type: 'filter', path: 'documentId' },
  ],
});

const textDefinition = {
  mappings: {
    dynamic: false,
    fields: {
      text: { type: 'string', analyzer: 'lucene.standard' },
      workspaceId: { type: 'objectId' },
      documentId: { type: 'objectId' },
    },
  },
};

// Creates the two search indexes if they are missing. Safe to run on every start.
//
// Returns false when this database cannot do Atlas Search (a plain mongod, with no search service next
// to it). Uploading and indexing still work there; searching is refused with a clear message.
export async function ensureSearchIndexes(
  database: Database,
  dimensions: number,
  logger: Logger,
): Promise<boolean> {
  try {
    const existing = (await database.chunks.listSearchIndexes().toArray()) as ExistingIndex[];
    const byName = new Map(existing.map((index) => [index.name, index]));

    const vector = byName.get(VECTOR_INDEX);
    if (!vector) {
      await createIfMissing(database, {
        name: VECTOR_INDEX,
        type: 'vectorSearch',
        definition: vectorDefinition(dimensions),
      });
    } else {
      const built = vector.latestDefinition?.fields?.find(
        (field) => field.type === 'vector',
      )?.numDimensions;
      // Vectors of one size cannot be searched with an index of another. Changing the embedding model
      // means re-embedding every document, so this is a stop, not something to fix silently.
      if (built !== dimensions) {
        throw new Error(
          `The vector index holds ${built}-dimensional vectors but EMBEDDING_DIMENSIONS is ${dimensions}. ` +
            'Changing the embedding model means dropping the index and re-processing every document.',
        );
      }
    }

    if (!byName.has(TEXT_INDEX)) {
      await createIfMissing(database, { name: TEXT_INDEX, definition: textDefinition });
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('EMBEDDING_DIMENSIONS')) throw error;
    logger.warn(
      { err: (error as Error).message },
      'Atlas Search is not available on this database; searching is switched off',
    );
    return false;
  }
}

// Replaces a vector index built for another vector size, when the deployment allows it (VECTOR_INDEX_REBUILD). The
// old vectors cannot be searched with the new embedder, so they are removed, and every document that had them is put
// back in the queue, where the requeue sweep picks it up within a minute and embeds it again. Nothing is lost: the
// original files are in storage. Without the setting, a size change stops the app instead (see above).
export async function rebuildVectorIndex(
  database: Database,
  embeddingModel: string,
  logger: Logger,
  timeoutMs = 120_000,
): Promise<number> {
  await database.chunks.dropSearchIndex(VECTOR_INDEX).catch(() => undefined);
  // dropping is asynchronous: creating the new one under the same name before the old has gone would be refused
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = (await database.chunks.listSearchIndexes(VECTOR_INDEX).toArray()).length;
    if (left === 0) break;
    if (Date.now() > deadline)
      throw new Error('The old vector index is still being removed. Start again in a minute.');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const stale = await database.chunks.distinct('documentId', {
    embeddingModel: { $ne: embeddingModel },
  });
  await database.chunks.deleteMany({ embeddingModel: { $ne: embeddingModel } });
  // an old updatedAt, so the sweep that re-queues stuck documents takes these at once
  await database.documents.updateMany(
    { _id: { $in: stale } },
    { $set: { status: 'queued', error: null, chunkCount: null, updatedAt: new Date(0) } },
  );
  logger.warn(
    { documents: stale.length },
    'vector index rebuilt for a new embedder; documents re-queued',
  );
  return stale.length;
}

// Search indexes catch up with writes a moment later. This waits until both hold every chunk the workspace has
// in the database, so a read that follows a write sees all of it, not a ranking of whatever had arrived. Used by
// tests and by the evaluation, which would otherwise score a half-built index.
export async function waitForSearchIndexes(
  core: Core,
  workspaceId: ObjectId,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const expected = await core.database.chunks.countDocuments({ workspaceId });
    let vectors = 0;
    let texts = 0;
    try {
      const [direction] = await core.embedder.embed(['count']);
      // any non-zero direction will do: with limit and numCandidates above the chunk count, the search
      // returns every chunk the vector index holds for this workspace
      const query = direction!.some((x) => x !== 0) ? direction! : [1, ...direction!.slice(1)];
      const inVectorIndex = await core.database.chunks
        .aggregate([
          {
            $vectorSearch: {
              index: VECTOR_INDEX,
              path: 'embedding',
              queryVector: query,
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
      vectors = (inVectorIndex[0]?.n as number | undefined) ?? 0;
      texts = (inTextIndex[0]?.count?.total as number | undefined) ?? 0;
    } catch {
      // the index may not be queryable yet; try again until the deadline
    }
    if (vectors === expected && texts === expected) return;
    if (Date.now() > deadline) {
      throw new Error(
        `The search indexes hold ${vectors} and ${texts} of ${expected} chunks after ${timeoutMs} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
