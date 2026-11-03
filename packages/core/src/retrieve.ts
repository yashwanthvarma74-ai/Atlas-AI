import type { ObjectId } from 'mongodb';
import type { WorkspaceAccess } from './access';
import type { Source } from './citations';
import type { Core } from './core';
import type { ChunkDoc } from './db';
import { EmbeddingError } from './embeddings';
import { unavailable } from './errors';
import { hex } from './ids';
import { reciprocalRankFusion } from './rank';
import { queryTerms, RERANKERS } from './rerank';
import { TEXT_INDEX, VECTOR_INDEX } from './search-indexes';

export interface RetrieveOptions {
  // narrow the search to these documents; documents outside the workspace match nothing
  documentIds?: ObjectId[];
  limit?: number;
}

// What a search stage hands on: enough to merge and show, with no text for chunks that did not make it.
type Hit = Pick<ChunkDoc, '_id' | 'documentId' | 'page' | 'text'>;

// Both searches filter on the workspace from the access proof, inside the search. Nothing the caller or
// a model supplies can widen that: a document filter is added to it with AND, never in place of it.
// This is the line the tenant-isolation suite attacks (see ADR 0007).
function vectorFilter(access: WorkspaceAccess, documentIds?: ObjectId[]) {
  return documentIds
    ? { $and: [{ workspaceId: access.workspaceId }, { documentId: { $in: documentIds } }] }
    : { workspaceId: access.workspaceId };
}

// The two stages are exported so the isolation suite can attack each one on its own. Through retrieve()
// alone, the name lookup at the end drops a leaked chunk too, which would hide a missing filter here.
export function vectorSearch(
  core: Core,
  access: WorkspaceAccess,
  vector: number[],
  pool: number,
  documentIds?: ObjectId[],
) {
  return core.database.chunks
    .aggregate<Hit>([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: 'embedding',
          queryVector: vector,
          // how many neighbours the approximate search considers before keeping `limit`
          numCandidates: Math.max(pool * 10, 100),
          limit: pool,
          filter: vectorFilter(access, documentIds),
        },
      },
      { $project: { documentId: 1, page: 1, text: 1 } },
    ])
    .toArray();
}

export function keywordSearch(
  core: Core,
  access: WorkspaceAccess,
  question: string,
  pool: number,
  documentIds?: ObjectId[],
) {
  // The question's own content words, so "what is the status of INV-20931" looks for inv and 20931
  // and not for "what" and "is".
  const query = queryTerms(question).join(' ');
  if (!query) return Promise.resolve<Hit[]>([]);

  const filter: object[] = [{ equals: { path: 'workspaceId', value: access.workspaceId } }];
  if (documentIds) filter.push({ in: { path: 'documentId', value: documentIds } });

  return core.database.chunks
    .aggregate<Hit>([
      {
        $search: {
          index: TEXT_INDEX,
          compound: { must: [{ text: { query, path: 'text' } }], filter },
        },
      },
      { $limit: pool },
      { $project: { documentId: 1, page: 1, text: 1 } },
    ])
    .toArray();
}

// Hybrid retrieval: a vector search finds passages that mean something close to the question, a keyword
// search finds passages that contain its exact words and codes, and reciprocal rank fusion merges the two
// ranked lists. The best few, optionally reranked, become the numbered sources S1, S2, ...
export async function retrieve(
  core: Core,
  access: WorkspaceAccess,
  question: string,
  options: RetrieveOptions = {},
): Promise<Source[]> {
  if (!core.searchAvailable) {
    throw unavailable(
      'Search is not available on this database. Run MongoDB Atlas, or Atlas Local.',
    );
  }
  const limit = options.limit ?? core.config.RETRIEVAL_LIMIT;
  const pool = Math.max(core.config.RETRIEVAL_POOL, limit);

  let vector: number[];
  try {
    [vector] = (await core.embedder.embed([question])) as [number[]];
  } catch (error) {
    if (error instanceof EmbeddingError) throw unavailable('The embedding service is unavailable.');
    throw error;
  }

  // Cosine similarity is undefined for a vector of zeros, which is what a question with no words in it
  // ("???") embeds to under some embedders. Without a direction there is nothing to compare, so only the
  // keyword side runs.
  const hasDirection = vector.some((x) => x !== 0);
  const [semantic, lexical] = await Promise.all([
    hasDirection
      ? vectorSearch(core, access, vector, pool, options.documentIds)
      : Promise.resolve<Hit[]>([]),
    keywordSearch(core, access, question, pool, options.documentIds),
  ]);

  const fused = reciprocalRankFusion([semantic, lexical], (hit) => hex(hit._id)).map(
    ({ item, score }) => ({ ...item, score }),
  );
  const ranked = RERANKERS[core.config.RERANKER](question, fused).slice(0, limit);

  // Names come from a second lookup that repeats the workspace filter, so a chunk can never be shown
  // with the name of a document from somewhere else.
  const documentIds = [
    ...new Map(ranked.map((hit) => [hex(hit.documentId), hit.documentId])).values(),
  ];
  const documents = await core.database.documents
    .find({ workspaceId: access.workspaceId, _id: { $in: documentIds } })
    .project<{ _id: ObjectId; name: string }>({ name: 1 })
    .toArray();
  const names = new Map(documents.map((doc) => [hex(doc._id), doc.name]));

  return ranked.flatMap((hit, index) => {
    const documentName = names.get(hex(hit.documentId));
    // a chunk whose document is gone (deleted a moment ago) is not a source
    if (documentName === undefined) return [];
    return [
      {
        n: index + 1,
        chunkId: hex(hit._id),
        documentId: hex(hit.documentId),
        documentName,
        page: hit.page,
        text: hit.text,
        score: hit.score,
      },
    ];
  });
}
