import type { EvalMetrics, EvalRun, Timing } from '@atlas/shared';
import type { Citation } from './citations';
import { queryTerms } from './rerank';

// ---- ranking metrics ----

// `ranks` has one entry per question: the 1-based position of the first passage that holds the answer in the
// search results, or null when none did.
export type Ranks = (number | null)[];

export const recallAt = (ranks: Ranks, k: number): number =>
  ranks.length === 0 ? 0 : ranks.filter((rank) => rank !== null && rank <= k).length / ranks.length;

// Nearest-rank percentile: the smallest value that at least p percent of the values are at or below.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

// ---- citation consistency ----

// The share of a claim's content words that appear in the passage it cites, from 0 to 1. A rough proxy for
// "the passage says this": it catches a citation that points at an unrelated passage, and it cannot catch a
// passage that is on topic but says the opposite. It is deliberately simple so that its limits are clear.
// Returns null for a claim with no content words, which has nothing to check.
export function supportScore(claim: string, passage: string): number | null {
  const terms = queryTerms(claim);
  if (terms.length === 0) return null;
  const words = new Set(queryTerms(passage));
  return terms.filter((term) => words.has(term)).length / terms.length;
}

const MARKER = /\[\s*S\d+(?:\s*,\s*S\d+)*\s*\]/g;

// For each citation marker in an answer, the text since the previous marker: what that marker is claimed to
// support.
export function claimsBeforeMarkers(answer: string): { claim: string; numbers: number[] }[] {
  const claims: { claim: string; numbers: number[] }[] = [];
  let from = 0;
  for (const match of answer.matchAll(MARKER)) {
    claims.push({
      claim: answer.slice(from, match.index).trim(),
      numbers: [...match[0].matchAll(/\d+/g)].map((m) => Number(m[0])),
    });
    from = match.index + match[0].length;
  }
  return claims;
}

export const SUPPORT_THRESHOLD = 0.5;

// Checks one saved answer: how many of its citations point at a passage that supports the claim before them.
export function checkCitations(
  answer: string,
  citations: Citation[],
  passageOf: (citation: Citation) => string,
): { checked: number; supported: number } {
  const byNumber = new Map(citations.map((c) => [c.n, c]));
  let checked = 0;
  let supported = 0;
  for (const { claim, numbers } of claimsBeforeMarkers(answer)) {
    for (const n of numbers) {
      const citation = byNumber.get(n);
      if (!citation) continue;
      const score = supportScore(claim, passageOf(citation));
      if (score === null) continue;
      checked++;
      if (score >= SUPPORT_THRESHOLD) supported++;
    }
  }
  return { checked, supported };
}

// ---- runs and the gate ----

export type { EvalMetrics, EvalRun, Timing };

export interface Comparison {
  ok: boolean;
  failures: string[];
  // every metric with its baseline, for printing
  rows: { name: string; baseline: number | null; current: number; gated: boolean; ok: boolean }[];
}

// The quality gate. A change fails if retrieval gets worse than the last accepted run by more than the noise,
// if citations stop pointing at passages that support them, or if one workspace is ever shown another's text.
// Latency and cost are reported, not gated: they depend on the machine, and a gate that fails on a busy laptop
// teaches people to ignore it.
export function compareRuns(current: EvalMetrics, baseline: EvalMetrics | null): Comparison {
  const failures: string[] = [];
  const rows: Comparison['rows'] = [];
  const row = (name: string, now: number, before: number | null, ok: boolean, gated = true) =>
    rows.push({ name, baseline: before, current: now, gated, ok });

  const noWorse = (name: string, now: number, before: number | undefined, slack: number) => {
    const ok = before === undefined || now >= before - slack;
    row(name, now, before ?? null, ok);
    if (!ok)
      failures.push(
        `${name} fell from ${before!.toFixed(3)} to ${now.toFixed(3)} (allowed drop ${slack})`,
      );
  };

  noWorse('recall@10', current.recallAt10, baseline?.recallAt10, 0.01);
  noWorse(
    'recall@10 (same words)',
    current.recallAt10ByKind.lexical,
    baseline?.recallAt10ByKind.lexical,
    0.02,
  );
  noWorse(
    'recall@10 (paraphrased)',
    current.recallAt10ByKind.paraphrase,
    baseline?.recallAt10ByKind.paraphrase,
    0.02,
  );

  const floor = Math.max(0.95, (baseline?.citationConsistency ?? 0) - 0.01);
  const citationsOk = current.citationConsistency >= floor;
  row(
    'citation consistency',
    current.citationConsistency,
    baseline?.citationConsistency ?? null,
    citationsOk,
  );
  if (!citationsOk) {
    failures.push(
      `citation consistency is ${current.citationConsistency.toFixed(3)}, below the floor of ${floor.toFixed(3)}`,
    );
  }

  const leaked = current.crossWorkspaceHits;
  row('cross-workspace hits', leaked, baseline?.crossWorkspaceHits ?? null, leaked === 0);
  if (leaked !== 0)
    failures.push(
      `${leaked} passages from another workspace were retrieved; the only allowed number is 0`,
    );

  row(
    'retrieval p95 (ms)',
    current.retrievalMs.p95,
    baseline?.retrievalMs.p95 ?? null,
    true,
    false,
  );
  row('first word p95 (ms)', current.ttftMs.p95, baseline?.ttftMs.p95 ?? null, true, false);

  return { ok: failures.length === 0, failures, rows };
}
