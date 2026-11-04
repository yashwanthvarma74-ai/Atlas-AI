import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import type { Config } from './config';
import { connect, ensureIndexes, type Database } from './db';
import { createEmbedder, type Embedder } from './embeddings';
import { createLlm, type LlmProvider } from './llm';
import { createQueues, type Queues } from './queues';
import { ensureSearchIndexes, rebuildVectorIndex } from './search-indexes';
import { createStorage, type Storage } from './storage';
import { defaultTools, type ToolRegistry } from './tools';

// Everything the domain code needs, created once per process and passed around explicitly.
export interface Core {
  config: Config;
  database: Database;
  // false on a database with no Atlas Search service: documents still index, but searching is refused
  searchAvailable: boolean;
  // Asks again whether search is there, at most every few seconds, and updates `searchAvailable`. A database
  // can finish starting its search service after the app has started, and that must not need a restart.
  recheckSearch(): Promise<boolean>;
  queues: Queues;
  storage: Storage;
  embedder: Embedder;
  llm: LlmProvider;
  tools: ToolRegistry;
  logger: Logger;
  close(): Promise<void>;
}

const SEARCH_RECHECK_MS = 10_000;

export interface CoreOptions {
  logger?: Logger;
  storage?: Storage;
  embedder?: Embedder;
  llm?: LlmProvider;
  tools?: ToolRegistry;
}

export async function createCore(config: Config, options: CoreOptions = {}): Promise<Core> {
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL });
  const database = await connect(config.MONGODB_URI);
  await ensureIndexes(database);
  const embedder = options.embedder ?? createEmbedder(config);
  let searchAvailable: boolean;
  try {
    searchAvailable = await ensureSearchIndexes(database, config.EMBEDDING_DIMENSIONS, logger);
  } catch (error) {
    // the embedder changed and the old index holds vectors of another size
    if (!config.VECTOR_INDEX_REBUILD) throw error;
    await rebuildVectorIndex(database, embedder.model, logger);
    searchAvailable = await ensureSearchIndexes(database, config.EMBEDDING_DIMENSIONS, logger);
  }

  // Fail fast when Redis is away instead of queueing commands until it returns: an upload then gets
  // a clear "try again" instead of hanging.
  const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  redis.on('error', (error) => logger.warn({ err: error.message }, 'redis error'));
  await waitForReady(redis, 3000);

  const queues = createQueues(redis, config.REDIS_PREFIX, config.INGEST_BACKOFF_MS);

  let lastSearchCheck = Date.now();
  const core: Core = {
    config,
    database,
    searchAvailable,
    async recheckSearch() {
      if (core.searchAvailable) return true;
      if (Date.now() - lastSearchCheck < SEARCH_RECHECK_MS) return false;
      lastSearchCheck = Date.now();
      core.searchAvailable = await ensureSearchIndexes(
        database,
        config.EMBEDDING_DIMENSIONS,
        logger,
      );
      return core.searchAvailable;
    },
    queues,
    storage: options.storage ?? createStorage(config),
    embedder,
    llm: options.llm ?? createLlm(config),
    tools: options.tools ?? defaultTools,
    logger,
    close: async () => {
      await queues.close().catch(() => undefined);
      redis.disconnect();
      await database.client.close();
    },
  };
  return core;
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
