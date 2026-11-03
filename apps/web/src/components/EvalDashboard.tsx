'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import type { EvalRun } from '@atlas/shared';
import { useEvalRuns, useRequireUser } from '@/lib/queries';
import styles from './EvalDashboard.module.css';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface Target {
  name: string;
  target: string;
  value: (run: EvalRun) => string;
  met: (run: EvalRun) => boolean;
}

// The targets are the spec's. "Not met" is a result, shown as plainly as "met".
const TARGETS: Target[] = [
  {
    name: 'Recall@10',
    target: '0.90 or more',
    value: (r) => pct(r.metrics.recallAt10),
    met: (r) => r.metrics.recallAt10 >= 0.9,
  },
  {
    name: 'Citation consistency',
    target: '95% or more',
    value: (r) => pct(r.metrics.citationConsistency),
    met: (r) => r.metrics.citationConsistency >= 0.95,
  },
  {
    name: 'Cross-workspace retrievals',
    target: '0',
    value: (r) => String(r.metrics.crossWorkspaceHits),
    met: (r) => r.metrics.crossWorkspaceHits === 0,
  },
];

// Recall@10 across runs, oldest to newest, as a line. The numbers beside it carry the meaning; the line is the shape.
function Trend({ runs }: { runs: EvalRun[] }) {
  const points = [...runs].reverse().map((run) => run.metrics.recallAt10);
  if (points.length < 2) return null;
  const width = 240;
  const height = 48;
  const path = points
    .map(
      (value, i) =>
        `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * width).toFixed(1)},${(height - value * height).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      className={styles.trend}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Recall at 10 across ${points.length} runs, from ${pct(points[0]!)} to ${pct(points.at(-1)!)}`}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function EvalDashboard() {
  const { loading } = useRequireUser();
  const runs = useEvalRuns();
  if (loading) return <Skeleton height="8rem" />;

  const latest = runs.data?.[0];
  return (
    <section aria-labelledby="eval-title" className={styles.page}>
      <h1 id="eval-title">Evaluation</h1>
      <p className={styles.note}>
        Scored on a generated benchmark with an offline embedder and answer model, so these show how
        the pipeline behaves, not how it would do on real documents with a real model.
      </p>

      {runs.isPending && <Skeleton height="8rem" />}
      {runs.error && (
        <Alert variant="danger" title="Could not load the evaluation runs">
          {runs.error.message}
        </Alert>
      )}
      {runs.data?.length === 0 && (
        <EmptyState
          title="No runs recorded"
          description="Run npm run check -w @atlas/eval -- --record to add one."
        />
      )}

      {latest && (
        <>
          <h2>Latest run</h2>
          <p className={styles.note}>
            Commit {latest.commit}
            {latest.dirty && ' (with uncommitted changes)'}, {when(latest.createdAt)}, chunks of{' '}
            {String(latest.config.chunkTokens)} tokens, reranker {String(latest.config.reranker)}.
          </p>
          <table className={styles.table}>
            <caption className={styles.caption}>Latest run against the targets</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Target</th>
                <th scope="col">Result</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {TARGETS.map((target) => (
                <tr key={target.name}>
                  <th scope="row">{target.name}</th>
                  <td>{target.target}</td>
                  <td>{target.value(latest)}</td>
                  <td>
                    <Badge variant={target.met(latest) ? 'success' : 'warning'}>
                      {target.met(latest) ? 'Met' : 'Not met'}
                    </Badge>
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row">Recall@10, paraphrased questions</th>
                <td>-</td>
                <td>{pct(latest.metrics.recallAt10ByKind.paraphrase)}</td>
                <td />
              </tr>
              <tr>
                <th scope="row">Search p95 / first word p95</th>
                <td>-</td>
                <td>
                  {latest.metrics.retrievalMs.p95} ms / {latest.metrics.ttftMs.p95} ms
                </td>
                <td />
              </tr>
              <tr>
                <th scope="row">Tokens and cost per answer</th>
                <td>-</td>
                <td>
                  {latest.metrics.tokensPerAnswer.input} in, {latest.metrics.tokensPerAnswer.output}{' '}
                  out,{' '}
                  {latest.metrics.costPerAnswerUsd === null
                    ? 'cost unknown'
                    : `$${latest.metrics.costPerAnswerUsd.toFixed(5)}`}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </>
      )}

      {runs.data && runs.data.length > 1 && (
        <>
          <h2>History</h2>
          <Trend runs={runs.data} />
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className={styles.caption}>Evaluation runs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Commit</th>
                  <th scope="col">Chunks</th>
                  <th scope="col">Recall@10</th>
                  <th scope="col">MRR</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((run) => (
                  <tr key={run.id}>
                    <td>{when(run.createdAt)}</td>
                    <td>{run.commit}</td>
                    <td>
                      {String(run.config.chunkTokens)} / {String(run.config.overlapTokens)},{' '}
                      {String(run.config.reranker)}
                    </td>
                    <td>{pct(run.metrics.recallAt10)}</td>
                    <td>{run.metrics.mrr.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
