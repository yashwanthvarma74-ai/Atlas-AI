'use client';

import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { useRequireUser, useWorkspace } from '@/lib/queries';
import DocumentLibrary from './DocumentLibrary';
import PageHeader from './PageHeader';
import SearchPanel from './SearchPanel';
import styles from './WorkspaceView.module.css';

export default function WorkspaceView({ id }: { id: string }) {
  const { user, loading: signingIn } = useRequireUser();
  const workspace = useWorkspace(id);

  if (signingIn || workspace.isPending) return <Skeleton height="8rem" />;

  if (workspace.error || !user) {
    const missing = workspace.error instanceof ApiError && workspace.error.status === 404;
    return (
      <EmptyState
        title={missing ? 'Workspace not found' : 'Could not load this workspace'}
        description={
          missing
            ? 'It may not exist, or you may not be a member of it.'
            : (workspace.error?.message ?? 'Try again in a moment.')
        }
        action={<Link href="/workspaces">Back to your workspaces</Link>}
      />
    );
  }

  const { data } = workspace;
  return (
    <div className={styles.page}>
      <PageHeader
        title={data.name}
        badge={<Badge variant="neutral">{data.role}</Badge>}
        description="Ask about the documents in this workspace. Answers cite the pages they come from."
      />
      <SearchPanel workspaceId={data.id} />
      <DocumentLibrary workspaceId={data.id} role={data.role} />
    </div>
  );
}
