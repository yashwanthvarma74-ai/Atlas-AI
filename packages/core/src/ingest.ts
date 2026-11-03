import { ObjectId } from 'mongodb';
import type { DocumentStatus } from '@atlas/shared';
import { chunkPages } from './chunk';
import type { Core } from './core';
import type { DocumentDoc } from './db';
import { EmbeddingError } from './embeddings';
import { HttpError } from './errors';
import { requireAccess } from './access';
import { ParseError, parseDocument, type ParseDeps } from './parse';
import type { IngestJob } from './queues';

// A problem retrying cannot fix: a damaged file, a rejected API key, an uploader who lost access. The
// queue gives up on it at once instead of spending its attempts.
export class PermanentIngestError extends Error {}

const stageTimeout = <T>(core: Core, stage: string, work: Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const ms = core.config.INGEST_STAGE_TIMEOUT_MS;
    const timer = setTimeout(
      () => reject(new Error(`The ${stage} stage took longer than ${ms} ms.`)),
      ms,
    );
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

async function setStatus(core: Core, doc: DocumentDoc, status: DocumentStatus) {
  const result = await core.database.documents.updateOne(
    { _id: doc._id, workspaceId: doc.workspaceId },
    { $set: { status, updatedAt: new Date() } },
  );
  // matched nothing: the document was deleted while this job ran
  return result.matchedCount === 1;
}

// Runs one document through parse, chunk, embed and index. Safe to run again for the same document: the
// chunks are replaced, never added to, so a retry after a half-finished attempt leaves no duplicates.
export async function processDocument(
  core: Core,
  job: IngestJob,
  deps: ParseDeps = {},
): Promise<void> {
  const workspaceId = new ObjectId(job.workspaceId);
  const userId = new ObjectId(job.userId);
  const documentId = new ObjectId(job.documentId);

  const doc = await core.database.documents.findOne({ _id: documentId, workspaceId });
  if (!doc) return;

  // The uploader may have been removed, or lost the editor role, while the job waited in the queue.
  try {
    await requireAccess(core, userId, workspaceId, 'editor');
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throw await fail(
      core,
      doc,
      'The person who uploaded this no longer has access to the workspace.',
    );
  }

  try {
    if (!(await setStatus(core, doc, 'parsing'))) return;
    const bytes = await core.storage.get(doc.storageKey);
    const pages = await stageTimeout(core, 'parsing', parseDocument(doc.kind, bytes, deps));

    const chunks = chunkPages(pages, {
      targetTokens: core.config.CHUNK_TARGET_TOKENS,
      overlapTokens: core.config.CHUNK_OVERLAP_TOKENS,
    });
    if (chunks.length === 0) {
      throw new ParseError(
        doc.kind === 'pdf'
          ? 'No text was found in this PDF. Scanned PDFs are not supported yet.'
          : 'No text was found in this file.',
      );
    }

    if (!(await setStatus(core, doc, 'embedding'))) return;
    const vectors = await stageTimeout(
      core,
      'embedding',
      core.embedder.embed(chunks.map((chunk) => chunk.text)),
    );

    // replace, never add: see the comment on this function
    await core.database.chunks.deleteMany({ documentId, workspaceId });
    await core.database.chunks.insertMany(
      chunks.map((chunk, i) => ({
        _id: new ObjectId(),
        workspaceId,
        documentId,
        ord: chunk.ord,
        page: chunk.page,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        embedding: vectors[i]!,
        embeddingModel: core.embedder.model,
      })),
    );

    const done = await core.database.documents.updateOne(
      { _id: documentId, workspaceId },
      {
        $set: {
          status: 'indexed',
          error: null,
          pageCount: pages.length,
          chunkCount: chunks.length,
          updatedAt: new Date(),
        },
      },
    );
    // deleted while embedding: do not leave its chunks behind
    if (done.matchedCount === 0) await core.database.chunks.deleteMany({ documentId, workspaceId });
  } catch (error) {
    if (error instanceof ParseError) throw await fail(core, doc, error.message);
    if (error instanceof EmbeddingError && !error.retryable) {
      throw await fail(
        core,
        doc,
        'The embedding service rejected this request. Check its settings.',
      );
    }
    throw error;
  }
}

// Marks the document failed for good and returns the error that tells the queue not to retry.
export async function fail(
  core: Core,
  doc: DocumentDoc,
  reason: string,
): Promise<PermanentIngestError> {
  await markFailed(core, doc._id, doc.workspaceId, reason);
  return new PermanentIngestError(reason);
}

export async function markFailed(
  core: Core,
  documentId: ObjectId,
  workspaceId: ObjectId,
  reason: string,
): Promise<void> {
  await core.database.documents.updateOne(
    { _id: documentId, workspaceId, status: { $ne: 'indexed' } },
    { $set: { status: 'failed', error: reason, updatedAt: new Date() } },
  );
}
