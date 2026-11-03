import { pino } from 'pino';
import { createCore, loadConfig } from '@atlas/core';
import { createApp } from './app';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });

const core = await createCore(config, { logger });
const server = createApp(core, logger).listen(config.API_PORT, () => {
  logger.info(`API listening on port ${config.API_PORT}`);
});

async function shutdown() {
  server.close();
  await core.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
