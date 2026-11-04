'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge, type BadgeVariant } from '@yashwanthvarma74/react/components/Badge';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import type { ToolCallStatus } from '@atlas/shared';
import { useAuditTrail, useRequireUser, useWorkspace } from '@/lib/queries';
import styles from './AuditTrail.module.css';

const VARIANT: Record<ToolCallStatus, BadgeVariant> = {
  proposed: 'warning',
  executing: 'info',
  executed: 'success',
  rejected: 'neutral',
  failed: 'danger',
  invalid: 'danger',
  expired: 'neutral',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Every request the assistant has made: what it asked for, who it was working for, who decided, and what came
// of it. Refused and rejected requests are here too, because the record is of what was asked, not only of what ran.
export default function AuditTrail({ workspaceId }: { workspaceId: string }) {
  const { loading } = useRequireUser();
  const workspace = useWorkspace(workspaceId);
  const trail = useAuditTrail(workspaceId);

  if (loading) return <Skeleton height="6rem" />;

  const owner = workspace.data?.role === 'owner';
  return (
    <section aria-labelledby="audit-title" className={styles.page}>
      <h1 id="audit-title">Audit trail</h1>
      <p className={styles.note}>
        {owner
          ? 'Every request the assistant has made in this workspace, newest first.'
          : 'Requests the assistant made in your conversations, newest first. The owner sees all of them.'}
      </p>

      {trail.isPending && <Skeleton height="6rem" />}
      {trail.error && (
        <Alert variant="danger" title="Could not load the audit trail">
          {trail.error.message}
        </Alert>
      )}
      {trail.data?.length === 0 && (
        <EmptyState
          title="Nothing yet"
          description="When the assistant asks to do something, it is recorded here."
        />
      )}

      {trail.data && trail.data.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.caption}>Assistant requests</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Request</th>
                <th scope="col">Asked for by</th>
                <th scope="col">Outcome</th>
                <th scope="col">Decided by</th>
              </tr>
            </thead>
            <tbody>
              {trail.data.map((call) => (
                <tr key={call.id}>
                  <td>{when(call.createdAt)}</td>
                  <td>
                    {call.description || `"${call.tool}"`}
                    {call.error && <span className={styles.error}>{call.error}</span>}
                    {call.result && <span className={styles.result}>{call.result.summary}</span>}
                  </td>
                  <td>{call.proposedByName}</td>
                  <td>
                    <Badge variant={VARIANT[call.status]}>{call.status}</Badge>
                  </td>
                  <td>
                    {call.decidedByName
                      ? `${call.decidedByName}, ${when(call.decidedAt!)}`
                      : 'Nobody'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
