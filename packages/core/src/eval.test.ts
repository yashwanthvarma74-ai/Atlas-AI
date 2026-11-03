import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Citation } from './citations';
import {
  checkCitations,
  claimsBeforeMarkers,
  compareRuns,
  mean,
  meanReciprocalRank,
  percentile,
  recallAt,
  supportScore,
  type EvalMetrics,
} from './eval';

describe('recallAt and MRR', () => {
  const ranks = [1, 3, null, 12, 2];

  it('counts a question as found when the answer is within the first k results', () => {
    expect(recallAt(ranks, 1)).toBeCloseTo(1 / 5);
    expect(recallAt(ranks, 3)).toBeCloseTo(3 / 5);
    expect(recallAt(ranks, 10)).toBeCloseTo(3 / 5);
    expect(recallAt(ranks, 20)).toBeCloseTo(4 / 5);
  });

  it('never goes down as k grows, and stays between 0 and 1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 1, max: 50 }), { nil: null })),
        (generated) => {
          let last = 0;
          for (const k of [1, 2, 5, 10, 25, 50]) {
            const value = recallAt(generated, k);
            expect(value).toBeGreaterThanOrEqual(last);
            expect(value).toBeLessThanOrEqual(1);
            last = value;
          }
        },
      ),
    );
  });

  it('is 0 for no questions rather than not a number', () => {
    expect(recallAt([], 10)).toBe(0);
    expect(meanReciprocalRank([])).toBe(0);
  });

  it('rewards finding the answer higher up', () => {
    expect(meanReciprocalRank([1, 1])).toBe(1);
    expect(meanReciprocalRank([1, 2])).toBeCloseTo(0.75);
    expect(meanReciprocalRank([null, 4])).toBeCloseTo(0.125);
  });
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 100)).toBe(100);
  });

  it('does not depend on the order, or change its input', () => {
    const values = [9, 1, 5, 3, 7];
    expect(percentile(values, 50)).toBe(5);
    expect(values).toEqual([9, 1, 5, 3, 7]);
  });

  it('handles one value and none', () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBe(0);
    expect(mean([2, 4])).toBe(3);
  });
});

describe('supportScore', () => {
  it("is the share of the claim's content words found in the passage", () => {
    expect(
      supportScore('Revenue grew 14 percent', 'Revenue grew 14 percent in the third quarter.'),
    ).toBe(1);
    expect(supportScore('Revenue grew 14 percent', 'Costs fell 14 percent.')).toBeCloseTo(0.5);
    expect(supportScore('Revenue grew 14 percent', 'The picnic is on Friday.')).toBe(0);
  });

  it('ignores filler words, so they do not make a claim look supported or unsupported', () => {
    expect(supportScore('the revenue of the company', 'Revenue, company.')).toBe(1);
  });

  it('has nothing to check for a claim made only of filler', () => {
    expect(supportScore('the of and', 'anything')).toBeNull();
  });
});

describe('claimsBeforeMarkers', () => {
  it('pairs each marker with the text since the one before', () => {
    expect(claimsBeforeMarkers('Revenue grew. [S1] Costs fell [S2, S3].')).toEqual([
      { claim: 'Revenue grew.', numbers: [1] },
      { claim: 'Costs fell', numbers: [2, 3] },
    ]);
  });

  it('finds nothing in an answer with no citations', () => {
    expect(claimsBeforeMarkers('No sources here.')).toEqual([]);
  });
});

describe('checkCitations', () => {
  const cite = (n: number): Citation => ({
    n,
    chunkId: `c${n}`,
    documentId: 'd',
    documentName: 'f',
    page: 1,
    quote: '',
  });
  const passages: Record<number, string> = {
    1: 'Revenue grew 14 percent in Asia.',
    2: 'The picnic is on Friday.',
  };

  it("counts a citation as supported when its passage contains the claim's words", () => {
    const result = checkCitations(
      'Revenue grew 14 percent. [S1]',
      [cite(1)],
      (c) => passages[c.n]!,
    );
    expect(result).toEqual({ checked: 1, supported: 1 });
  });

  it('catches a citation that points at an unrelated passage', () => {
    const result = checkCitations(
      'Revenue grew 14 percent [S2].',
      [cite(2)],
      (c) => passages[c.n]!,
    );
    expect(result).toEqual({ checked: 1, supported: 0 });
  });

  it('skips a number that is not among the citations', () => {
    expect(checkCitations('Said so [S9].', [cite(1)], (c) => passages[c.n]!)).toEqual({
      checked: 0,
      supported: 0,
    });
  });
});

describe('compareRuns', () => {
  const base: EvalMetrics = {
    questions: { answerable: 200, unanswerable: 30 },
    recallAt1: 0.6,
    recallAt5: 0.8,
    recallAt10: 0.85,
    mrr: 0.7,
    recallAt10ByKind: { lexical: 0.95, paraphrase: 0.75 },
    rejectedUnanswerable: null,
    citationConsistency: 0.98,
    citationsChecked: 300,
    crossWorkspaceHits: 0,
    retrievalMs: { p50: 20, p95: 40 },
    ttftMs: { p50: 30, p95: 60 },
    totalMs: { p50: 40, p95: 80 },
    tokensPerAnswer: { input: 500, output: 40 },
    costPerAnswerUsd: 0,
  };
  const worse = (changes: Partial<EvalMetrics>): EvalMetrics => ({ ...base, ...changes });

  it('passes a run identical to the baseline, and a first run with no baseline', () => {
    expect(compareRuns(base, base).ok).toBe(true);
    expect(compareRuns(base, null).ok).toBe(true);
  });

  it('allows ordinary noise but not a real drop in recall', () => {
    expect(compareRuns(worse({ recallAt10: 0.845 }), base).ok).toBe(true);
    const failed = compareRuns(worse({ recallAt10: 0.8 }), base);
    expect(failed.ok).toBe(false);
    expect(failed.failures[0]).toMatch(/recall@10 fell from 0\.850 to 0\.800/);
  });

  it('fails when only the paraphrased questions get worse', () => {
    const result = compareRuns(
      worse({ recallAt10ByKind: { lexical: 0.95, paraphrase: 0.6 } }),
      base,
    );
    expect(result.ok).toBe(false);
    expect(result.failures.join()).toMatch(/paraphrased/);
  });

  it('fails when citations stop supporting their claims, even if the baseline was already that bad', () => {
    expect(
      compareRuns(worse({ citationConsistency: 0.9 }), worse({ citationConsistency: 0.9 })).ok,
    ).toBe(false);
  });

  it('allows citation consistency to move by noise, and not by more than a point', () => {
    expect(compareRuns(worse({ citationConsistency: 0.975 }), base).ok).toBe(true);
    // above the 0.95 floor, but more than a point below the 0.98 it was accepted at
    expect(compareRuns(worse({ citationConsistency: 0.96 }), base).ok).toBe(false);
  });

  it('fails on a single passage from another workspace', () => {
    const result = compareRuns(worse({ crossWorkspaceHits: 1 }), base);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/only allowed number is 0/);
  });

  it('reports speed and does not fail on it', () => {
    const slow = compareRuns(worse({ retrievalMs: { p50: 500, p95: 4000 } }), base);
    expect(slow.ok).toBe(true);
    expect(slow.rows.find((r) => r.name === 'retrieval p95 (ms)')).toMatchObject({
      gated: false,
      current: 4000,
      baseline: 40,
    });
  });

  it('only gates rejection of unanswerable questions once a cutoff is in use', () => {
    const withCutoff = worse({ rejectedUnanswerable: 0.9 });
    expect(compareRuns(worse({ rejectedUnanswerable: null }), withCutoff).ok).toBe(true);
    expect(compareRuns(worse({ rejectedUnanswerable: 0.7 }), withCutoff).ok).toBe(false);
  });
});
