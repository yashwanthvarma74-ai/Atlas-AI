import { Router } from 'express';
import { toolDecisionSchema } from '@atlas/shared';
import { decideToolCall, listAuditTrail, type Core } from '@atlas/core';
import { idParam, limit, parse, workspaceAccess } from '../http';
import { requireUser } from '../middleware';

// Mounted at /workspaces/:id/tool-calls.
export function toolCallsRouter(core: Core): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  const writes = limit(core.config, 60 * 1000, 30);

  // Every request the assistant made in this workspace, newest first. The owner sees all of them, and anyone
  // else sees the ones from their own conversations.
  router.get('/', async (req, res) => {
    res.json({ toolCalls: await listAuditTrail(core, await workspaceAccess(core, req)) });
  });

  // Approve or reject. Approving runs the tool, once, as the person who is asking; who may do that is decided
  // in @atlas/core, where the role and the conversation's author are checked at this moment.
  router.post('/:tid', writes, async (req, res) => {
    const access = await workspaceAccess(core, req);
    const { decision } = parse(toolDecisionSchema, req.body);
    res.json({
      toolCall: await decideToolCall(core, access, idParam(req, 'tid', 'That request'), decision),
    });
  });

  return router;
}
