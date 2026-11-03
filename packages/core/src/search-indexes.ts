import type { Logger } from 'pino';
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
