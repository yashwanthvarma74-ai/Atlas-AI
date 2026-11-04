'use client';

import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { useRequireUser, useWorkspace } from '@/lib/queries';
import MemberList from './MemberList';
import PageHeader from './PageHeader';
import styles from './WorkspaceView.module.css';

export default function MembersView({ id }: { id: string }) {
  const { user, loading } = useRequireUser();
  const workspace = useWorkspace(id);
  if (loading || !user || !workspace.data) return <Skeleton height="8rem" />;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Members"
        description="People who can open this workspace, and what each of them may do."
      />
      <MemberList workspaceId={id} userId={user.id} role={workspace.data.role} />
    </div>
  );
}
