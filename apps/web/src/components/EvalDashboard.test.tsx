import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EvalMetrics, EvalRun } from '@atlas/shared';
import { expectNoAxeViolations, json, renderWithProviders } from '@/test/render';
import EvalDashboard from './EvalDashboard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const metrics = (recallAt10: number): EvalMetrics => ({
  questions: { answerable: 240, unanswerable: 36 },
  recallAt1: 0.5,
  recallAt5: 0.8,
  recallAt10,
  mrr: 0.63,
  recallAt10ByKind: { lexical: 0.92, paraphrase: 0.85 },
  rejectedUnanswerable: null,
  citationConsistency: 1,
  citationsChecked: 500,
  crossWorkspaceHits: 0,
  retrievalMs: { p50: 2, p95: 5 },
  ttftMs: { p50: 4, p95: 7 },
  totalMs: { p50: 5, p95: 8 },
  tokensPerAnswer: { input: 500, output: 40 },
  costPerAnswerUsd: 0,
});
const run = (id: string, recall: number): EvalRun & { id: string } => ({
  id,
  commit: `c${id}`,
  dirty: false,
  createdAt: `2026-11-0${id}T00:00:00.000Z`,
  datasetHash: 'abc',
  config: { chunkTokens: 64, overlapTokens: 0, reranker: 'coverage' },
  metrics: metrics(recall),
});

function show(runs: (EvalRun & { id: string })[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/auth/me')
      ? json(200, { user: { id: 'u', name: 'U', email: null, guest: true } })
      : json(200, { runs }),
  );
  return renderWithProviders(<EvalDashboard />);
}

describe('EvalDashboard', () => {
  it('shows the latest run against the targets, saying plainly when one is not met', async () => {
    const { container } = show([run('2', 0.887), run('1', 0.717)]);

    expect(
      await screen.findByRole('row', { name: /Recall@10 0\.90 or more 88\.7% Not met/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: /Citation consistency 95% or more 100\.0% Met/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: /Cross-workspace retrievals 0 0 Met/ }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('lists the history with a described trend', async () => {
    show([run('3', 0.9), run('2', 0.8), run('1', 0.7)]);
    expect(
      await screen.findByRole('img', { name: /across 3 runs, from 70\.0% to 90\.0%/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5);
  });

  it('says what to do when nothing has been recorded', async () => {
    show([]);
    expect(await screen.findByText('No runs recorded')).toBeInTheDocument();
  });
});
