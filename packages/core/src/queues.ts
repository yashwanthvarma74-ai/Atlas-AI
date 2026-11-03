import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// What a job carries: ids only. The worker reads everything else from the database when it runs, so a
// job can never act on stale or forged data, and it checks the uploader's access again at that moment.
export interface IngestJob {
  documentId: string;
  workspaceId: string;
  userId: string;
}

export const INGEST_ATTEMPTS = 3;

export interface Queues {
  ingest: Queue<IngestJob>;
  close(): Promise<void>;
}

export function createQueues(connection: Redis, prefix: string, backoffMs: number): Queues {
  const ingest = new Queue<IngestJob>('ingest', {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: INGEST_ATTEMPTS,
      backoff: { type: 'exponential', delay: backoffMs },
      removeOnComplete: true,
      // failed jobs stay for a week: that is the dead-letter list to inspect, with the reason on each
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
  return { ingest, close: () => ingest.close() };
}

// The job id is the document id, so queueing the same document twice (a retried request, the sweep
// below) is one job, not two. A finished job with that id is removed first, so a retry can run again.
export async function enqueueIngest(queues: Queues, job: IngestJob): Promise<void> {
  const existing = await queues.ingest.getJob(job.documentId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') await existing.remove();
    else return;
  }
  await queues.ingest.add('ingest', job, { jobId: job.documentId });
}

export async function cancelIngest(queues: Queues, documentId: string): Promise<void> {
  const job = await queues.ingest.getJob(documentId);
  // an active job is left alone: the worker finds the document gone and stops
  if (job && (await job.getState()) !== 'active') await job.remove().catch(() => undefined);
}
