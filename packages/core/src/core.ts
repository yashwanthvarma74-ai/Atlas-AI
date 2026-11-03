import { pino, type Logger } from 'pino';
import type { Config } from './config';
import { connect, ensureIndexes, type Database } from './db';

// Everything the domain code needs, created once per process and passed around explicitly.
export interface Core {
  config: Config;
  database: Database;
  logger: Logger;
  close(): Promise<void>;
}

export interface CoreOptions {
  logger?: Logger;
}

export async function createCore(config: Config, options: CoreOptions = {}): Promise<Core> {
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL });
  const database = await connect(config.MONGODB_URI);
  await ensureIndexes(database);

  return {
    config,
    database,
    logger,
    close: () => database.client.close(),
  };
}
