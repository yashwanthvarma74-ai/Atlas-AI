import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { createCore, loadConfig, startIngestWorker, startTracing } from '@atlas/core';
import { createApp } from './app';

const config = loadConfig();
const flushTraces = await startTracing('atlas-api');
const logger = pino({ level: config.LOG_LEVEL });

const core = await createCore(config, { logger });
// load the embedding model now, so the first search or upload does not wait for it
void core.embedder.embed(['ready'], 'query').catch(() => undefined);
// hosts that assign the port say so in PORT
const port = Number(process.env.PORT ?? config.API_PORT);
const worker = config.INLINE_WORKER
  ? startIngestWorker(
      core,
      config.PARSE_ISOLATION === 'process'
        ? { isolate: { childPath: fileURLToPath(new URL('./parse-child.js', import.meta.url)) } }
        : {},
    )
  : undefined;
const server = createApp(core, logger).listen(port, () => {
  logger.info(`API listening on port ${port}${worker ? ', ingest worker inside' : ''}`);
});

async function shutdown() {
  server.close();
  await worker?.stop();
  await core.close();
  await flushTraces();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
