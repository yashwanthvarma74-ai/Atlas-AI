import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compareRuns, connect, loadConfig, type EvalRun } from '@atlas/core';
import { formatComparison, formatRun, formatSweep } from './report';
import { runEval, type RunOptions } from './run';

const BASELINE = new URL('../baseline.json', import.meta.url).pathname;
const RESULTS = new URL('../results/', import.meta.url).pathname;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    chunk: { type: 'string' },
    overlap: { type: 'string' },
    reranker: { type: 'string' },
    'min-score': { type: 'string' },
    'min-scores': { type: 'string', default: '0,0.1,0.2,0.3,0.4,0.5,0.6,0.7' },
    chunks: { type: 'string', default: '64,128,256,512' },
    overlaps: { type: 'string', default: '0,32' },
    rerankers: { type: 'string', default: 'none,coverage' },
    record: { type: 'boolean', default: false },
    'update-baseline': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const defaults = loadConfig({});
const optionsFrom = (): RunOptions => ({
  chunkTokens: Number(values.chunk ?? defaults.CHUNK_TARGET_TOKENS),
  overlapTokens: Number(values.overlap ?? defaults.CHUNK_OVERLAP_TOKENS),
  reranker: (values.reranker ?? defaults.RERANKER) as RunOptions['reranker'],
  minScore:
    values['min-score'] !== undefined ? Number(values['min-score']) : defaults.RETRIEVAL_MIN_SCORE,
  log: (message) => console.error(message),
});

// Saves a run where the dashboard reads them: the app's own database, not the throwaway one the run used.
async function record(run: EvalRun) {
  const database = await connect(
    process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/atlas_ai?directConnection=true',
  );
  try {
    await database.evalRuns.insertOne({ ...run, _id: undefined as never });
  } finally {
    await database.client.close();
  }
}

const readBaseline = (): EvalRun | null => {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as EvalRun;
  } catch {
    return null;
  }
};

async function main() {
  const [command = 'run'] = positionals;

  if (command === 'run') {
    const run = await runEval(optionsFrom());
    console.log(values.json ? JSON.stringify(run, null, 2) : formatRun(run));
    if (values.record) await record(run);
    return;
  }

  if (command === 'check') {
    const run = await runEval(optionsFrom());
    const baseline = readBaseline();
    console.log(formatRun(run));
    if (baseline && baseline.datasetHash !== run.datasetHash) {
      console.log(
        `\nThe baseline was scored on dataset ${baseline.datasetHash} and this run on ${run.datasetHash}. Regenerate the baseline with --update-baseline.`,
      );
      process.exitCode = 1;
      return;
    }
    const comparison = compareRuns(run.metrics, baseline?.metrics ?? null);
    console.log(
      `\nAgainst ${baseline ? `the baseline from commit ${baseline.commit}` : 'no baseline (first run)'}:\n${formatComparison(comparison)}`,
    );

    if (values.record) await record(run);
    if (values['update-baseline']) {
      writeFileSync(BASELINE, `${JSON.stringify(run, null, 2)}\n`);
      console.log(`\nWrote ${BASELINE}`);
    }
    if (!comparison.ok) {
      console.log(`\nFAILED:\n${comparison.failures.map((f) => `  - ${f}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('\nPassed.');
    }
    return;
  }

  if (command === 'sweep') {
    const list = (text: string) => text.split(',').map((x) => x.trim());
    const runs: EvalRun[] = [];
    for (const chunk of list(values.chunks!).map(Number)) {
      for (const overlap of list(values.overlaps!).map(Number)) {
        for (const reranker of list(values.rerankers!) as RunOptions['reranker'][]) {
          if (overlap * 2 > chunk) continue;
          console.error(`chunk ${chunk}, overlap ${overlap}, reranker ${reranker}`);
          runs.push(
            await runEval({
              ...optionsFrom(),
              chunkTokens: chunk,
              overlapTokens: overlap,
              reranker,
            }),
          );
        }
      }
    }
    console.log(formatSweep(runs));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}sweep.json`, `${JSON.stringify(runs, null, 2)}\n`);
    return;
  }

  if (command === 'cutoff') {
    // what each minimum similarity costs (answerable questions that lose their answer) and what it buys
    // (unanswerable questions that correctly get nothing)
    const lines = [`${'min score'.padEnd(11)}${'recall@10'.padEnd(12)}unanswerable rejected`];
    for (const minScore of values['min-scores']!.split(',').map(Number)) {
      console.error(`min score ${minScore}`);
      const m = (await runEval({ ...optionsFrom(), minScore })).metrics;
      const recall = `${(m.recallAt10 * 100).toFixed(1)}%`;
      lines.push(
        `${String(minScore).padEnd(11)}${recall.padEnd(12)}${((m.rejectedUnanswerable ?? 0) * 100).toFixed(1)}%`,
      );
    }
    console.log(lines.join('\n'));
    return;
  }

  console.error(
    'Usage: eval <run|check|sweep|cutoff> [--chunk N] [--overlap N] [--reranker none|coverage] [--min-score X] [--record]',
  );
  process.exitCode = 2;
}

await main();
