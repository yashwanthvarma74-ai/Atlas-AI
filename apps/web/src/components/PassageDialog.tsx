'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@yashwanthvarma74/react/components/Dialog';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { VisuallyHidden } from '@yashwanthvarma74/react/components/VisuallyHidden';
import { useEffect, useRef } from 'react';
import type { SearchSource } from '@atlas/shared';
import { usePassages } from '@/lib/queries';
import styles from './PassageDialog.module.css';

interface Props {
  workspaceId: string;
  // the passage to show in context; null while the dialog is closed
  source: SearchSource | null;
  onClose: () => void;
}

// Opens the page a citation points at and marks the cited passage among its neighbours.
export default function PassageDialog({ workspaceId, source, onClose }: Props) {
  const passages = usePassages(
    workspaceId,
    source?.documentId ?? '',
    source?.page ?? 1,
    source !== null,
  );
  const cited = useRef<HTMLParagraphElement>(null);

  // bring the cited passage into view once the page's passages have loaded
  useEffect(() => {
    cited.current?.scrollIntoView?.({ block: 'center' });
  }, [passages.data]);

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>
          {source?.documentName}, page {source?.page}
        </DialogTitle>
        <DialogDescription>
          The passages on this page, in order. The one S{source?.n} points at is marked.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {passages.isPending && <Skeleton height="6rem" />}
        {passages.error && (
          <Alert variant="danger" title="Could not load this page">
            {passages.error.message}
          </Alert>
        )}
        {passages.data?.length === 0 && <p>This page has no stored passages any more.</p>}
        <div className={styles.passages}>
          {passages.data?.map((passage) => {
            const isCited = passage.id === source?.chunkId;
            return (
              <p
                key={passage.id}
                ref={isCited ? cited : undefined}
                className={isCited ? styles.cited : styles.passage}
                aria-current={isCited ? 'true' : undefined}
              >
                {isCited && <VisuallyHidden>Cited passage: </VisuallyHidden>}
                {passage.text}
              </p>
            );
          })}
        </div>
      </DialogBody>
      <DialogClose />
    </Dialog>
  );
}
