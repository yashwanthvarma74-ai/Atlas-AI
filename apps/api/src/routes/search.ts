import { Router } from 'express';
import type { ObjectId } from 'mongodb';
import { searchInputSchema } from '@atlas/shared';
import { badRequest, parseId, retrieve, type Core } from '@atlas/core';
import { limit, parse, workspaceAccess } from '../http';
import { requireUser } from '../middleware';

// Mounted at /workspaces/:id/search.
export function searchRouter(core: Core): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  // Each search embeds the question, which can cost money on a hosted model, so it is capped per address.
  const searches = limit(core.config, 60 * 1000, 30);

  // Anyone in the workspace may search it, viewers included: reading is what the viewer role is for.
  router.post('/', searches, async (req, res) => {
    const access = await workspaceAccess(core, req);
    const { query, documentIds } = parse(searchInputSchema, req.body);

    const parsed = documentIds?.map(parseId);
    const ids = parsed?.filter((id): id is ObjectId => id !== null);
    if (ids && ids.length !== parsed?.length)
      throw badRequest('One of the document ids is not valid.');

    res.json({ sources: await retrieve(core, access, query, { documentIds: ids }) });
  });

  return router;
}
