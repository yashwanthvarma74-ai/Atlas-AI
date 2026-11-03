import type { EvalRun } from '@atlas/shared';
import type { Core } from './core';

// The most recent evaluation runs, newest first, for the dashboard. They describe the system and a synthetic
// benchmark, not anyone's workspace, so they are not scoped to one.
export async function listEvalRuns(core: Core, limit = 30): Promise<(EvalRun & { id: string })[]> {
  const docs = await core.database.evalRuns.find().sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.map(({ _id, ...run }) => ({ id: _id.toHexString(), ...run }));
}
