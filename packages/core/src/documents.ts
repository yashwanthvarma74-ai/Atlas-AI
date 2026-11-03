import { ObjectId } from 'mongodb';
import { UPLOAD_MAX_BYTES, type DocumentSummary } from '@atlas/shared';
import type { WorkspaceAccess } from './access';
import type { Core } from './core';
import type { DocumentDoc } from './db';
import { badRequest, notFound, tooLarge, unavailable, unsupportedMedia } from './errors';
import { hex } from './ids';
import { cancelIngest, enqueueIngest } from './queues';
import { sniffFile } from './sniff';

const LIST_LIMIT = 200;
const DOWNLOAD_LINK_SECONDS = 5 * 60;

export const toDocumentSummary = (doc: DocumentDoc): DocumentSummary => ({
  id: hex(doc._id),
  name: doc.name,
  kind: doc.kind,
  size: doc.size,
  status: doc.status,
  error: doc.error,
  pageCount: doc.pageCount,
  chunkCount: doc.chunkCount,
  uploadedBy: hex(doc.uploadedBy),
  createdAt: doc.createdAt.toISOString(),
});

// Every lookup below filters on the workspace from the access proof as well as the document id, so a
// document id from another workspace is "not found" even if someone guesses it.
async function findDocument(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<DocumentDoc> {
  const doc = await core.database.documents.findOne({ _id: id, workspaceId: access.workspaceId });
  if (!doc) throw notFound('That document');
  return doc;
}

// The caller has proved they are an editor. The file type comes from the bytes, never from the name or
// the Content-Type the browser sent.
export async function uploadDocument(
  core: Core,
  access: WorkspaceAccess,
  input: { name: string; bytes: Uint8Array },
): Promise<DocumentSummary> {
  if (input.bytes.length === 0) throw badRequest('That file is empty.');
  if (input.bytes.length > UPLOAD_MAX_BYTES) {
    throw tooLarge(`Files can be at most ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  const sniffed = sniffFile(input.bytes);
  if (!sniffed) throw unsupportedMedia('Upload a PDF, a PNG or JPEG image, or a plain text file.');

  const _id = new ObjectId();
  const now = new Date();
  const doc: DocumentDoc = {
    _id,
    workspaceId: access.workspaceId,
    name: input.name,
    kind: sniffed.kind,
    mimeType: sniffed.mimeType,
    size: input.bytes.length,
    storageKey: `${hex(access.workspaceId)}/${hex(_id)}`,
    status: 'queued',
    error: null,
    pageCount: null,
    chunkCount: null,
    uploadedBy: access.userId,
    createdAt: now,
    updatedAt: now,
  };

  await core.storage.put(doc.storageKey, input.bytes, sniffed.mimeType);
  await core.database.documents.insertOne(doc);
  try {
    await queue(core, access, doc);
  } catch {
    // Without a job the document would sit in "queued" for ever, and the user cannot tell why.
    await core.database.documents.deleteOne({ _id });
    await core.storage.delete(doc.storageKey).catch(() => undefined);
    throw unavailable('Processing is unavailable right now. Try again in a moment.');
  }
  return toDocumentSummary(doc);
}

const queue = (core: Core, access: WorkspaceAccess, doc: DocumentDoc) =>
  enqueueIngest(core.queues, {
    documentId: hex(doc._id),
    workspaceId: hex(access.workspaceId),
    userId: hex(access.userId),
  });

export async function listDocuments(
  core: Core,
  access: WorkspaceAccess,
): Promise<DocumentSummary[]> {
  const docs = await core.database.documents
    .find({ workspaceId: access.workspaceId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIST_LIMIT)
    .toArray();
  return docs.map(toDocumentSummary);
}

export async function getDocument(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<DocumentSummary> {
  return toDocumentSummary(await findDocument(core, access, id));
}

export async function deleteDocument(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<void> {
  const doc = await findDocument(core, access, id);
  // The row goes first. A worker that is mid-way through this document then finds nothing to update,
  // and cleans up the chunks it wrote instead of bringing the document back.
  await core.database.documents.deleteOne({ _id: doc._id, workspaceId: access.workspaceId });
  await core.database.chunks.deleteMany({ documentId: doc._id, workspaceId: access.workspaceId });
  await cancelIngest(core.queues, hex(doc._id)).catch(() => undefined);
  await core.storage.delete(doc.storageKey);
}

// Puts a failed document back in the queue, from the start.
export async function retryDocument(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<DocumentSummary> {
  const doc = await findDocument(core, access, id);
  if (doc.status !== 'failed') throw badRequest('Only a failed document can be retried.');

  const queued = { ...doc, status: 'queued' as const, error: null, updatedAt: new Date() };
  try {
    await queue(core, access, queued);
  } catch {
    throw unavailable('Processing is unavailable right now. Try again in a moment.');
  }
  await core.database.documents.updateOne(
    { _id: doc._id, workspaceId: access.workspaceId },
    { $set: { status: 'queued', error: null, updatedAt: queued.updatedAt } },
  );
  return toDocumentSummary(queued);
}

export type DocumentFile = { url: string } | { bytes: Uint8Array; name: string; mimeType: string };

// Either a short-lived link straight to storage, or, for a driver without links, the bytes themselves
// for the API to stream. Either way the caller has already proved they belong to the workspace.
export async function openDocumentFile(
  core: Core,
  access: WorkspaceAccess,
  id: ObjectId,
): Promise<DocumentFile> {
  const doc = await findDocument(core, access, id);
  const url = await core.storage.downloadUrl(doc.storageKey, doc.name, DOWNLOAD_LINK_SECONDS);
  if (url) return { url };
  return { bytes: await core.storage.get(doc.storageKey), name: doc.name, mimeType: doc.mimeType };
}
