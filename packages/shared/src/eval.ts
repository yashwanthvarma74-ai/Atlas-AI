// What an evaluation run measures, shared so the dashboard in the browser reads the same shape the harness writes.

export interface Timing {
  p50: number;
  p95: number;
}

export interface EvalMetrics {
  questions: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  recallAt10ByKind: { lexical: number; paraphrase: number };
  // the share of citations whose passage supports the claim, and how many were checked
  citationConsistency: number;
  citationsChecked: number;
  // sources shown to a workspace that belong to another one. Must be 0.
  crossWorkspaceHits: number;
  retrievalMs: Timing;
  ttftMs: Timing;
  totalMs: Timing;
  tokensPerAnswer: { input: number; output: number };
  costPerAnswerUsd: number | null;
}

export interface EvalRun {
  commit: string;
  // true when the working tree had changes that are not in `commit`
  dirty: boolean;
  createdAt: string;
  datasetHash: string;
  config: Record<string, string | number | boolean | null>;
  metrics: EvalMetrics;
}
