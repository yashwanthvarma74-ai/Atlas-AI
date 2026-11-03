'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { Card, CardTitle } from '@yashwanthvarma74/react/components/Card';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import Link from 'next/link';
import { useState } from 'react';
import { useRequireUser, useWorkspaces } from '@/lib/queries';
import CreateWorkspaceDialog from './CreateWorkspaceDialog';
import styles from './WorkspaceList.module.css';

export default function WorkspaceList() {
  const { loading: signingIn } = useRequireUser();
  const workspaces = useWorkspaces();
  const [creating, setCreating] = useState(false);

  if (signingIn) return <Skeleton height="6rem" />;

  return (
    <section aria-labelledby="workspaces-title" className={styles.page}>
      <div className={styles.heading}>
        <h1 id="workspaces-title">Workspaces</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New workspace
        </Button>
      </div>

      {workspaces.isPending && (
        <div className={styles.grid} aria-busy="true" aria-label="Loading workspaces">
          <Skeleton height="5rem" />
          <Skeleton height="5rem" />
        </div>
      )}

      {workspaces.error && (
        <Alert variant="danger" title="Could not load your workspaces">
          {workspaces.error.message}
        </Alert>
      )}

      {workspaces.data?.length === 0 && (
        <EmptyState
          title="No workspaces yet"
          description="Create one to start adding documents."
          action={<Button onClick={() => setCreating(true)}>New workspace</Button>}
        />
      )}

      {workspaces.data && workspaces.data.length > 0 && (
        <ul className={styles.grid}>
          {workspaces.data.map((workspace) => (
            <li key={workspace.id} className={styles.item}>
              <Card interactive>
                <div className={styles.card}>
                  <CardTitle>
                    <Link href={`/w/${workspace.id}`} className={styles.link}>
                      {workspace.name}
                    </Link>
                  </CardTitle>
                  <Badge variant={workspace.role === 'owner' ? 'accent' : 'neutral'}>
                    {workspace.role}
                  </Badge>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}
