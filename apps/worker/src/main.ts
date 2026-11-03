import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { createCore, loadConfig, startIngestWorker, startTracing } from '@atlas/core';

const config = loadConfig();
const flushTraces = await startTracing('atlas-worker');
const logger = pino({ level: config.LOG_LEVEL });

const core = await createCore(config, { logger });

// the parser child is built next to this file
const parseDeps = (mode: string) =>
  mode === 'process'
    ? { isolate: { childPath: fileURLToPath(new URL('./parse-child.js', import.meta.url)) } }
    : {};
const worker = startIngestWorker(core, parseDeps(config.PARSE_ISOLATION));
logger.info(
  { embeddings: core.embedder.provider, model: core.embedder.model },
  'Ingest worker running',
);

async function shutdown() {
  // lets the job in progress finish before the connections close
  await worker.stop();
  await core.close();
  await flushTraces();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
