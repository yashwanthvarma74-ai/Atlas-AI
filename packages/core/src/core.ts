import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import type { Config } from './config';
import { connect, ensureIndexes, type Database } from './db';
import { createEmbedder, type Embedder } from './embeddings';
import { createQueues, type Queues } from './queues';
import { createStorage, type Storage } from './storage';

// Everything the domain code needs, created once per process and passed around explicitly.
export interface Core {
  config: Config;
  database: Database;
  queues: Queues;
  storage: Storage;
  embedder: Embedder;
  logger: Logger;
  close(): Promise<void>;
}

export interface CoreOptions {
  logger?: Logger;
  storage?: Storage;
  embedder?: Embedder;
}

export async function createCore(config: Config, options: CoreOptions = {}): Promise<Core> {
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL });
  const database = await connect(config.MONGODB_URI);
  await ensureIndexes(database);

  // Fail fast when Redis is away instead of queueing commands until it returns: an upload then gets
  // a clear "try again" instead of hanging.
  const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  redis.on('error', (error) => logger.warn({ err: error.message }, 'redis error'));
  await waitForReady(redis, 3000);

  const queues = createQueues(redis, config.REDIS_PREFIX, config.INGEST_BACKOFF_MS);

  return {
    config,
    database,
    queues,
    storage: options.storage ?? createStorage(config),
    embedder: options.embedder ?? createEmbedder(config),
    logger,
    close: async () => {
      await queues.close().catch(() => undefined);
      redis.disconnect();
      await database.client.close();
    },
  };
}

// Waits for the first connection so the first command does not fail while it is still being made.
// If Redis is away the process starts anyway and uploads are refused until it comes back.
function waitForReady(redis: Redis, timeoutMs: number): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      redis.off('ready', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    redis.once('ready', done);
  });
}
