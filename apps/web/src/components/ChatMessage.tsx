'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { Spinner } from '@yashwanthvarma74/react/components/Spinner';
import { stripToolCalls, type Citation, type Message } from '@atlas/shared';
import type { Pending } from '@/lib/useChat';
import Answer from './Answer';
import styles from './ChatMessage.module.css';

// 410 ms reads better than 0.4 s, and 0.0 s says nothing at all
const duration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

// a fraction of a cent, so show enough digits to see it
const dollars = (amount: number) => `$${amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2)}`;

export function UserMessage({ content }: { content: string }) {
  return (
    <li className={styles.user}>
      <p className={styles.userText}>{content}</p>
    </li>
  );
}

interface AssistantProps {
  message: Message;
  // whether the person can write this answer again: only the last answer of their own conversation
  canRetry: boolean;
  onRetry: () => void;
  onOpen: (citation: Citation) => void;
}

// A saved answer: complete, stopped part-way, or failed.
export function AssistantMessage({ message, canRetry, onRetry, onOpen }: AssistantProps) {
  const known = message.citations.map(({ n, documentName, page }) => ({ n, documentName, page }));
  const { latency, usage, costUsd } = message;

  return (
    <li className={styles.assistant}>
      {message.citations.length > 0 && (
        <ul className={styles.sources} aria-label="Sources">
          {message.citations.map((citation) => (
            <li key={citation.n}>
              <button type="button" className={styles.source} onClick={() => onOpen(citation)}>
                <strong>S{citation.n}</strong> {citation.documentName}, page {citation.page}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message.content && (
        <Answer
          content={message.content}
          known={known}
          citations={message.citations}
          onOpen={onOpen}
        />
      )}

      {message.status === 'stopped' && (
        <p className={styles.note}>
          <Badge variant="warning">Stopped</Badge> You stopped this answer.
        </p>
      )}
      {message.status === 'failed' && (
        <Alert variant="danger" title="The answer could not be finished">
          {message.error}
        </Alert>
      )}

      <div className={styles.footer}>
        {latency && message.status !== 'failed' && (
          <span className={styles.meta}>
            {latency.ttftMs !== null && `First word in ${duration(latency.ttftMs)} · `}
            {duration(latency.totalMs)}
            {usage && ` · ${usage.outputTokens} tokens`}
            {costUsd !== null && costUsd > 0 && ` · ${dollars(costUsd)}`}
          </span>
        )}
        {canRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {message.status === 'failed' ? 'Retry' : 'Regenerate'}
          </Button>
        )}
      </div>
    </li>
  );
}

// The answer being written. Before the first word it says what the server is doing, and it shows the time
// to the first word as soon as that is known.
export function PendingAnswer({ pending }: { pending: Pending }) {
  const known = pending.sources ?? [];
  // a tool request is not part of the words, and a half-arrived one is not shown at all
  const words = stripToolCalls(pending.content);
  const waiting = words === '';

  return (
    <li className={styles.assistant} aria-busy="true">
      {waiting && (
        <p className={styles.working}>
          <Spinner size="sm" label={pending.stopping ? 'Stopping' : 'Working'} />
          {pending.stopping
            ? 'Stopping…'
            : pending.sources === null
              ? 'Searching your documents…'
              : pending.sources.length === 0
                ? 'Nothing found in your documents.'
                : `Found ${pending.sources.length} ${pending.sources.length === 1 ? 'passage' : 'passages'}. Writing…`}
        </p>
      )}
      {!waiting && <Answer content={words} known={known} />}
      {pending.ttftMs !== null && (
        <p className={styles.meta}>First word in {duration(pending.ttftMs)}</p>
      )}
    </li>
  );
}
