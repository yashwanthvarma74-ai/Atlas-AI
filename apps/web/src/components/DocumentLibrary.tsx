'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge, type BadgeVariant } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@yashwanthvarma74/react/components/Dialog';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { Progress } from '@yashwanthvarma74/react/components/Progress';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { VisuallyHidden } from '@yashwanthvarma74/react/components/VisuallyHidden';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  hasRole,
  IN_PROGRESS_STATUSES,
  UPLOAD_MAX_BYTES,
  type DocumentStatus,
  type DocumentSummary,
  type Role,
} from '@atlas/shared';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import {
  useDeleteDocument,
  useDocuments,
  useRetryDocument,
  useUploadDocuments,
} from '@/lib/queries';
import styles from './DocumentLibrary.module.css';

const STATUS: Record<DocumentStatus, { label: string; variant: BadgeVariant; progress: number }> = {
  queued: { label: 'Queued', variant: 'neutral', progress: 10 },
  parsing: { label: 'Parsing', variant: 'info', progress: 40 },
  embedding: { label: 'Embedding', variant: 'info', progress: 75 },
  indexed: { label: 'Indexed', variant: 'success', progress: 100 },
  failed: { label: 'Failed', variant: 'danger', progress: 0 },
};

// when a document was added, short: the date only matters to tell files apart
const added = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const ACCEPT = '.pdf,.txt,.md,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg';

// Says out loud, politely, when a document finishes or fails, so people who cannot see the badge
// change are told. Nothing is announced for what was already settled when the page loaded.
function useStatusAnnouncement(documents: DocumentSummary[] | undefined) {
  const previous = useRef<Map<string, DocumentStatus>>(new Map());
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!documents) return;
    for (const doc of documents) {
      const before = previous.current.get(doc.id);
      if (before && before !== doc.status && !IN_PROGRESS_STATUSES.includes(doc.status)) {
        setMessage(`${doc.name}: ${STATUS[doc.status].label.toLowerCase()}`);
      }
    }
    previous.current = new Map(documents.map((doc) => [doc.id, doc.status]));
  }, [documents]);

  return message;
}

export default function DocumentLibrary({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: Role;
}) {
  const documents = useDocuments(workspaceId);
  const upload = useUploadDocuments(workspaceId);
  const retry = useRetryDocument(workspaceId);
  const remove = useDeleteDocument(workspaceId);
  const input = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const announcement = useStatusAnnouncement(documents.data);
  const canEdit = hasRole(role, 'editor');

  const [dragging, setDragging] = useState(false);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    send(files);
  }

  // files dropped anywhere on the documents section are uploaded, the same as picked ones
  const drop = canEdit
    ? {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          send(Array.from(event.dataTransfer.files));
        },
      }
    : {};

  function send(files: File[]) {
    // too big is known before sending, so say so without spending the upload
    const tooBig = files.filter((file) => file.size > UPLOAD_MAX_BYTES);
    setRejected(tooBig.map((file) => `${file.name} is over ${formatBytes(UPLOAD_MAX_BYTES)}.`));
    const sendable = files.filter((file) => file.size <= UPLOAD_MAX_BYTES);
    if (sendable.length > 0) upload.mutate(sendable);
  }

  const failures = [
    ...rejected.map((message) => ({ name: '', message })),
    ...(upload.data ?? []).map((f) => ({ name: f.name, message: `${f.name}: ${f.message}` })),
  ];

  return (
    <section
      aria-labelledby="documents-title"
      className={`${styles.section} ${dragging ? styles.dragging : ''}`}
      {...drop}
    >
      <div className={styles.heading}>
        <h2 id="documents-title">Documents</h2>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className={styles.picker}
              onChange={onPick}
              tabIndex={-1}
              aria-hidden="true"
            />
            <Button
              variant="primary"
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              Upload documents
            </Button>
          </>
        )}
      </div>

      <VisuallyHidden role="status" aria-live="polite">
        {announcement}
      </VisuallyHidden>

      {failures.length > 0 && (
        <Alert variant="danger" title="Some files were not uploaded">
          <ul className={styles.problems}>
            {failures.map((failure) => (
              <li key={failure.message}>{failure.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {documents.error && (
        <Alert variant="danger" title="Could not load the documents">
          {documents.error.message}
        </Alert>
      )}
      {documents.isPending && <Skeleton height="4rem" />}

      {documents.data?.length === 0 && (
        <div className={styles.dropzone}>
          <EmptyState
            title="No documents yet"
            description={
              canEdit
                ? 'Drop PDFs, text files or images here, or use Upload documents. Each one is read, split into passages and indexed.'
                : 'Someone with the editor role needs to add documents.'
            }
          />
        </div>
      )}

      {documents.data && documents.data.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col" className={`${styles.number} ${styles.optional}`}>
                  Size
                </th>
                <th scope="col" className={`${styles.number} ${styles.optional}`}>
                  Pages
                </th>
                <th scope="col" className={`${styles.number} ${styles.optional}`}>
                  Passages
                </th>
                <th scope="col" className={styles.optional}>
                  Added
                </th>
                <th scope="col">
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.data.map((doc) => {
                const status = STATUS[doc.status];
                const working = IN_PROGRESS_STATUSES.includes(doc.status);
                return (
                  <tr key={doc.id}>
                    <td className={styles.nameCell}>
                      <span className={styles.kind} aria-hidden="true">
                        {doc.kind === 'pdf' ? 'PDF' : doc.kind === 'image' ? 'IMG' : 'TXT'}
                      </span>
                      <span className={styles.nameText}>
                        <span className={styles.name} title={doc.name}>
                          {doc.name}
                        </span>
                        {working && (
                          <Progress
                            label={`Processing ${doc.name}`}
                            value={status.progress}
                            size="sm"
                          />
                        )}
                        {doc.status === 'failed' && doc.error && (
                          <span className={styles.error}>{doc.error}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className={`${styles.number} ${styles.optional}`}>
                      {formatBytes(doc.size)}
                    </td>
                    <td className={`${styles.number} ${styles.optional}`}>
                      {doc.pageCount ?? '–'}
                    </td>
                    <td className={`${styles.number} ${styles.optional}`}>
                      {doc.chunkCount ?? '–'}
                    </td>
                    <td className={`${styles.muted} ${styles.optional}`}>
                      {added.format(new Date(doc.createdAt))}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Download ${doc.name}`}
                          onClick={() =>
                            window.location.assign(api.documentFileUrl(workspaceId, doc.id))
                          }
                        >
                          Download
                        </Button>
                        {canEdit && doc.status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Retry ${doc.name}`}
                            loading={retry.isPending && retry.variables === doc.id}
                            onClick={() => retry.mutate(doc.id)}
                          >
                            Retry
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${doc.name}`}
                            onClick={() => setDeleting(doc)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        role="alertdialog"
        size="sm"
      >
        <DialogHeader>
          <DialogTitle>Delete {deleting?.name}?</DialogTitle>
          <DialogDescription>
            The file and everything indexed from it are removed, and answers can no longer cite it.
          </DialogDescription>
        </DialogHeader>
        {remove.error && (
          <DialogBody>
            <Alert variant="danger" title="Could not delete it">
              {remove.error.message}
            </Alert>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}
