import { Router, type Request } from 'express';
import type { Role } from '@atlas/shared';
import {
  addMemberInputSchema,
  createWorkspaceInputSchema,
  updateMemberInputSchema,
} from '@atlas/shared';
import {
  addMember,
  changeMemberRole,
  createWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  type Core,
} from '@atlas/core';
import { idParam, limit, parse, workspaceAccess } from '../http';
import { conversationsRouter } from './conversations';
import { documentsRouter } from './documents';
import { searchRouter } from './search';
import { requireUser } from '../middleware';

export function workspacesRouter(core: Core): Router {
  const router = Router();
  router.use(requireUser);

  const writes = limit(core.config, 60 * 1000, 30);

  // Every route below that names a workspace starts here, so none of them can skip the check.
  const accessFor = (req: Request, minimum?: Role) => workspaceAccess(core, req, minimum);

  router.get('/', async (req, res) => {
    res.json({ workspaces: await listWorkspaces(core, req.user!._id) });
  });

  router.post('/', writes, async (req, res) => {
    const input = parse(createWorkspaceInputSchema, req.body);
    res.status(201).json({ workspace: await createWorkspace(core, req.user!, input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ workspace: await getWorkspace(core, await accessFor(req)) });
  });

  router.get('/:id/members', async (req, res) => {
    res.json({ members: await listMembers(core, await accessFor(req)) });
  });

  router.post('/:id/members', writes, async (req, res) => {
    const access = await accessFor(req, 'owner');
    const member = await addMember(core, access, parse(addMemberInputSchema, req.body));
    res.status(201).json({ member });
  });

  router.patch('/:id/members/:userId', writes, async (req, res) => {
    const access = await accessFor(req, 'owner');
    const { role } = parse(updateMemberInputSchema, req.body);
    await changeMemberRole(core, access, idParam(req, 'userId', 'That member'), role);
    res.status(204).end();
  });

  router.delete('/:id/members/:userId', writes, async (req, res) => {
    // any member may call this: removing yourself is leaving, and removeMember decides the rest
    const access = await accessFor(req);
    await removeMember(core, access, idParam(req, 'userId', 'That member'));
    res.status(204).end();
  });

  router.use('/:id/documents', documentsRouter(core));
  router.use('/:id/search', searchRouter(core));
  router.use('/:id/conversations', conversationsRouter(core));

  return router;
}
