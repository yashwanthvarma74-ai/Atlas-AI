import express, { Router } from 'express';
import { UPLOAD_MAX_BYTES, uploadQuerySchema } from '@atlas/shared';
import {
  badRequest,
  deleteDocument,
  getDocument,
  listDocuments,
  listPassages,
  openDocumentFile,
  retryDocument,
  unsupportedMedia,
  uploadDocument,
  type Core,
} from '@atlas/core';
import { idParam, limit, parse, workspaceAccess } from '../http';
import { requireUser } from '../middleware';

// Mounted at /workspaces/:id/documents.
export function documentsRouter(core: Core): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  const uploads = limit(core.config, 60 * 1000, 20);
  const writes = limit(core.config, 60 * 1000, 60);

  router.get('/', async (req, res) => {
    res.json({ documents: await listDocuments(core, await workspaceAccess(core, req)) });
  });

  // The file is the request body, sent as application/octet-stream with its name in the query. That
  // keeps the upload a plain stream the size limit can cut off, with no multipart parsing to attack.
  router.post(
    '/',
    uploads,
    express.raw({ type: 'application/octet-stream', limit: UPLOAD_MAX_BYTES }),
    async (req, res) => {
      const access = await workspaceAccess(core, req, 'editor');
      const { name } = parse(uploadQuerySchema, req.query);
      if (!Buffer.isBuffer(req.body)) {
        throw unsupportedMedia(
          'Send the file as the request body with Content-Type: application/octet-stream.',
        );
      }
      const document = await uploadDocument(core, access, { name, bytes: req.body });
      res.status(202).json({ document });
    },
  );

  router.get('/:docId', async (req, res) => {
    const access = await workspaceAccess(core, req);
    res.json({ document: await getDocument(core, access, idParam(req, 'docId', 'That document')) });
  });

  router.get('/:docId/file', async (req, res) => {
    const access = await workspaceAccess(core, req);
    const file = await openDocumentFile(core, access, idParam(req, 'docId', 'That document'));
    if ('url' in file) {
      res.redirect(302, file.url);
      return;
    }
    // Served as a download, never rendered in place, and never sniffed into anything else: an uploaded
    // file is untrusted content even though only workspace members can fetch it.
    res
      .type(file.mimeType)
      .set({
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(Buffer.from(file.bytes));
  });

  // The stored passages of one page, so a citation can be shown in context with the cited one marked.
  router.get('/:docId/passages', async (req, res) => {
    const access = await workspaceAccess(core, req);
    const page = Number(req.query.page);
    if (!Number.isInteger(page) || page < 1)
      throw badRequest('Give the page as a whole number from 1.');
    const id = idParam(req, 'docId', 'That document');
    res.json({ passages: await listPassages(core, access, id, page) });
  });

  router.post('/:docId/retry', writes, async (req, res) => {
    const access = await workspaceAccess(core, req, 'editor');
    res.status(202).json({
      document: await retryDocument(core, access, idParam(req, 'docId', 'That document')),
    });
  });

  router.delete('/:docId', writes, async (req, res) => {
    const access = await workspaceAccess(core, req, 'editor');
    await deleteDocument(core, access, idParam(req, 'docId', 'That document'));
    res.status(204).end();
  });

  return router;
}
