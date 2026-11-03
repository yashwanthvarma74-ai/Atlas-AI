import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvalMetrics } from '@atlas/shared';
import { createTestApp, type TestApp } from './test/context';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.destroy());

const metrics: EvalMetrics = {
  questions: 240,
  recallAt1: 0.5,
  recallAt5: 0.8,
  recallAt10: 0.89,
  recallAt10ByKind: { lexical: 0.92, paraphrase: 0.85 },
  citationConsistency: 1,
  citationsChecked: 500,
  crossWorkspaceHits: 0,
  retrievalMs: { p50: 3, p95: 6 },
  ttftMs: { p50: 5, p95: 8 },
  totalMs: { p50: 6, p95: 9 },
  tokensPerAnswer: { input: 500, output: 40 },
  costPerAnswerUsd: 0,
};
const run = (commit: string, createdAt: string) => ({
  _id: new ObjectId(),
  commit,
  dirty: false,
  createdAt,
  datasetHash: 'abc123',
  config: { chunkTokens: 64, overlapTokens: 0, reranker: 'coverage' },
  metrics,
});

describe('GET /eval/runs', () => {
  it('needs a signed-in user', async () => {
    await t.anonymous().get('/eval/runs').expect(401);
  });

  it('lists the runs newest first, with their metrics', async () => {
    await t.core.database.evalRuns.insertMany([
      run('aaa1111', '2026-11-01T00:00:00.000Z'),
      run('ccc3333', '2026-11-03T00:00:00.000Z'),
      run('bbb2222', '2026-11-02T00:00:00.000Z'),
    ]);
    const user = await t.signUp('reader@eval.test');
    const res = await user.get('/eval/runs').expect(200);

    expect(res.body.runs.map((r: { commit: string }) => r.commit)).toEqual([
      'ccc3333',
      'bbb2222',
      'aaa1111',
    ]);
    expect(res.body.runs[0]).toMatchObject({
      metrics: { recallAt10: 0.89, crossWorkspaceHits: 0 },
      config: { chunkTokens: 64 },
    });
    expect(res.body.runs[0].id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body.runs[0]._id).toBeUndefined();
  });

  it('returns an empty list, not an error, when nothing has been recorded', async () => {
    const empty = await createTestApp();
    try {
      const user = await empty.signUp('first@eval.test');
      expect((await user.get('/eval/runs').expect(200)).body).toEqual({ runs: [] });
    } finally {
      await empty.destroy();
    }
  });
});
