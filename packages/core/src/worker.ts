import { UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ObjectId } from 'mongodb';
import type { Core } from './core';
import { purgeExpiredGuests } from './guests';
import { hex } from './ids';
import { failAllStaleAnswers } from './answer';
import { describeFailure, markFailed, PermanentIngestError, processDocument } from './ingest';
import { enqueueIngest, INGEST_ATTEMPTS, type IngestJob } from './queues';
import type { ParseDeps } from './parse';

const SWEEP_EVERY_MS = 60_000;
// A document still "queued" this long after upload has no job: the process died between saving it and
// queueing it, or Redis lost the job.
const STALE_AFTER_MS = 2 * 60_000;

export interface IngestWorker {
  stop(): Promise<void>;
}

export function startIngestWorker(core: Core, deps: ParseDeps = {}): IngestWorker {
  // a worker holds a blocking connection, which must not give up retrying commands
  const connection = new Redis(core.config.REDIS_URL, { maxRetriesPerRequest: null });
  const log = core.logger.child({ component: 'ingest-worker' });

  const worker = new Worker<IngestJob>(
    'ingest',
    async (job) => {
      try {
        await processDocument(core, job.data, deps);
      } catch (error) {
        // BullMQ retries any other error, with backoff, up to the attempt limit
        if (error instanceof PermanentIngestError) throw new UnrecoverableError(error.message);
        throw error;
      }
    },
    { connection, prefix: core.config.REDIS_PREFIX, concurrency: core.config.INGEST_CONCURRENCY },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const exhausted = job.attemptsMade >= INGEST_ATTEMPTS;
    const permanent = error instanceof UnrecoverableError;
    log.warn(
      { documentId: job.data.documentId, attempt: job.attemptsMade, err: error.message },
      'ingest failed',
    );
    // Out of attempts: the job stays in BullMQ's failed set as the dead letter, and the user is told.
    if (exhausted && !permanent) {
      void markFailed(
        core,
        new ObjectId(job.data.documentId),
        new ObjectId(job.data.workspaceId),
        describeFailure(error),
      );
    }
  });
  worker.on('error', (error) => log.error({ err: error.message }, 'worker error'));

  const sweep = setInterval(() => {
    void requeueStale(core).catch(() => undefined);
    void failAllStaleAnswers(core).catch(() => undefined);
    void purgeExpiredGuests(core).catch(() => undefined);
  }, SWEEP_EVERY_MS);

  return {
    async stop() {
      clearInterval(sweep);
      await worker.close();
      connection.disconnect();
    },
  };
}

// Queues again any document that was saved but never got a job. Queueing is idempotent per document, so
// running this while a job exists does nothing.
export async function requeueStale(core: Core, olderThanMs = STALE_AFTER_MS): Promise<number> {
  const stale = await core.database.documents
    .find({ status: 'queued', updatedAt: { $lt: new Date(Date.now() - olderThanMs) } })
    .limit(100)
    .toArray();
  for (const doc of stale) {
    await enqueueIngest(core.queues, {
      documentId: hex(doc._id),
      workspaceId: hex(doc.workspaceId),
      userId: hex(doc.uploadedBy),
    });
  }
  return stale.length;
}
