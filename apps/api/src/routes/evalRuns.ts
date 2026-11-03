import { Router } from 'express';
import { listEvalRuns, type Core } from '@atlas/core';
import { requireUser } from '../middleware';

// The evaluation history behind the dashboard. Anyone signed in can read it: it measures the system on a
// benchmark of generated documents, and holds nothing from any workspace.
export function evalRunsRouter(core: Core): Router {
  const router = Router();
  router.use(requireUser);
  router.get('/', async (_req, res) => {
    res.json({ runs: await listEvalRuns(core) });
  });
  return router;
}
