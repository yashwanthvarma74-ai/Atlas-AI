import type { Comparison, EvalRun } from '@atlas/core';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const ms = (value: number) => `${value} ms`;
const usd = (value: number | null) =>
  value === null ? 'unknown' : value === 0 ? '$0' : `$${value.toFixed(5)}`;

export function formatRun(run: EvalRun): string {
  const { metrics: m, config } = run;
  const rows: [string, string][] = [
    ['commit', `${run.commit}${run.dirty ? ' (uncommitted changes)' : ''}`],
    ['dataset', `${run.datasetHash}: ${m.questions} questions`],
    ['embedder / model', `${config.embedder} / ${config.llm}`],
    [
      'chunks',
      `${config.chunkTokens} tokens, ${config.overlapTokens} overlap, ${config.passages} passages, reranker ${config.reranker}`,
    ],
    ['', ''],
    ['recall@1 / @5 / @10', `${pct(m.recallAt1)} / ${pct(m.recallAt5)} / ${pct(m.recallAt10)}`],
    ['  same words', pct(m.recallAt10ByKind.lexical)],
    ['  paraphrased', pct(m.recallAt10ByKind.paraphrase)],
    ['citation consistency', `${pct(m.citationConsistency)} of ${m.citationsChecked} citations`],
    ['cross-workspace hits', String(m.crossWorkspaceHits)],
    ['', ''],
    ['search p50 / p95', `${ms(m.retrievalMs.p50)} / ${ms(m.retrievalMs.p95)}`],
    ['first word p50 / p95', `${ms(m.ttftMs.p50)} / ${ms(m.ttftMs.p95)}`],
    ['whole answer p50 / p95', `${ms(m.totalMs.p50)} / ${ms(m.totalMs.p95)}`],
    ['tokens per answer', `${m.tokensPerAnswer.input} in, ${m.tokensPerAnswer.output} out`],
    ['cost per answer', usd(m.costPerAnswerUsd)],
  ];
  return rows.map(([name, value]) => (name ? `${name.padEnd(24)}${value}` : '')).join('\n');
}

export function formatComparison(comparison: Comparison): string {
  const fmt = (name: string, value: number | null) =>
    value === null
      ? '-'
      : name.includes('(ms)') || name.includes('hits')
        ? String(value)
        : value.toFixed(3);
  const lines = comparison.rows.map((row) => {
    const mark = !row.gated ? ' ' : row.ok ? 'ok' : 'FAIL';
    return `${mark.padEnd(5)}${row.name.padEnd(26)}${fmt(row.name, row.baseline).padStart(10)}  ->${fmt(row.name, row.current).padStart(10)}`;
  });
  return [
    `${'     metric'.padEnd(31)}${'baseline'.padStart(10)}      ${'now'.padStart(8)}`,
    ...lines,
  ].join('\n');
}

// One line per configuration, best first.
export function formatSweep(runs: EvalRun[]): string {
  const header = `${'chunk'.padEnd(7)}${'overlap'.padEnd(9)}${'rerank'.padEnd(10)}${'passages'.padEnd(10)}${'recall@10'.padEnd(11)}${'same'.padEnd(8)}${'para'.padEnd(8)}${'recall@1'.padEnd(10)}`;
  const lines = [...runs]
    .sort((a, b) => b.metrics.recallAt10 - a.metrics.recallAt10)
    .map((run) => {
      const { config: c, metrics: m } = run;
      return `${String(c.chunkTokens).padEnd(7)}${String(c.overlapTokens).padEnd(9)}${String(c.reranker).padEnd(10)}${String(c.passages).padEnd(10)}${pct(m.recallAt10).padEnd(11)}${pct(m.recallAt10ByKind.lexical).padEnd(8)}${pct(m.recallAt10ByKind.paraphrase).padEnd(8)}${pct(m.recallAt1).padEnd(10)}`;
    });
  return [header, ...lines].join('\n');
}
