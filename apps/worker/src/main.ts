import { pino } from 'pino';
import { createCore, loadConfig, startIngestWorker, startTracing } from '@atlas/core';

const config = loadConfig();
const flushTraces = await startTracing('atlas-worker');
const logger = pino({ level: config.LOG_LEVEL });

const core = await createCore(config, { logger });
const worker = startIngestWorker(core);
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
