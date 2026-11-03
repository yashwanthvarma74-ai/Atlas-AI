'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge, type BadgeVariant } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import type { ToolCall, ToolCallStatus } from '@atlas/shared';
import { useDecideToolCall } from '@/lib/queries';
import styles from './ToolCallCard.module.css';

const STATUS: Record<ToolCallStatus, { label: string; variant: BadgeVariant }> = {
  proposed: { label: 'Waiting for you', variant: 'warning' },
  executing: { label: 'Running', variant: 'info' },
  executed: { label: 'Done', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'neutral' },
  failed: { label: 'Failed', variant: 'danger' },
  invalid: { label: 'Not valid', variant: 'danger' },
  expired: { label: 'Expired', variant: 'neutral' },
};

interface Props {
  call: ToolCall;
  workspaceId: string;
  conversationId: string;
  // whether this person may decide it: the author of the conversation, with a role that allows the tool
  canDecide: boolean;
}

// A request from the assistant that is waiting for a person. It shows exactly what will be done, in the
// arguments' own words, because the model chose them and the person is the check on that.
export default function ToolCallCard({ call, workspaceId, conversationId, canDecide }: Props) {
  const decide = useDecideToolCall(workspaceId, conversationId);
  const { label, variant } = STATUS[call.status];
  const waiting = call.status === 'proposed';
  const busy = decide.isPending;

  return (
    <li className={styles.card} aria-label={`Request: ${call.description}`}>
      <div className={styles.head}>
        <strong className={styles.title}>
          {call.description || `A request for "${call.tool}"`}
        </strong>
        <Badge variant={variant}>{label}</Badge>
      </div>

      {/* what will be used, exactly as the model wrote it. React shows it as text, never as markup. */}
      {call.status !== 'invalid' && (
        <dl className={styles.args}>
          {Object.entries(call.args).map(([name, value]) => (
            <div key={name} className={styles.arg}>
              <dt>{name}</dt>
              <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {call.status === 'executed' && call.result && (
        <p className={styles.outcome}>
          {call.result.summary}
          {call.decidedByName && ` by ${call.decidedByName}`}.
        </p>
      )}
      {call.status === 'rejected' && (
        <p className={styles.outcome}>
          Rejected{call.decidedByName && ` by ${call.decidedByName}`}. Nothing was changed.
        </p>
      )}
      {(call.status === 'failed' || call.status === 'invalid') && call.error && (
        <p className={styles.problem}>{call.error}</p>
      )}
      {call.status === 'expired' && (
        <p className={styles.outcome}>Nobody decided in time. Ask again if you still want it.</p>
      )}

      {waiting && canDecide && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="sm"
            loading={busy && decide.variables?.decision === 'approve'}
            disabled={busy}
            onClick={() => decide.mutate({ id: call.id, decision: 'approve' })}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy && decide.variables?.decision === 'reject'}
            disabled={busy}
            onClick={() => decide.mutate({ id: call.id, decision: 'reject' })}
          >
            Reject
          </Button>
        </div>
      )}
      {waiting && !canDecide && (
        <p className={styles.outcome}>Only the person who asked can approve this.</p>
      )}
      {decide.error && (
        <Alert variant="danger" title="Could not do that">
          {decide.error.message}
        </Alert>
      )}
    </li>
  );
}
