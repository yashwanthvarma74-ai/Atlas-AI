'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Avatar } from '@yashwanthvarma74/react/components/Avatar';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@yashwanthvarma74/react/components/Dialog';
import { Select } from '@yashwanthvarma74/react/components/Select';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { useToast } from '@yashwanthvarma74/react/components/Toast';
import { VisuallyHidden } from '@yashwanthvarma74/react/components/VisuallyHidden';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { memberRoleSchema, type Member, type Role } from '@atlas/shared';
import { useChangeRole, useMembers, useRemoveMember } from '@/lib/queries';
import AddMemberForm from './AddMemberForm';
import styles from './MemberList.module.css';

interface Props {
  workspaceId: string;
  // the signed-in user and their role in this workspace
  userId: string;
  role: Role;
}

export default function MemberList({ workspaceId, userId, role }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const members = useMembers(workspaceId);
  const changeRole = useChangeRole(workspaceId);
  const remove = useRemoveMember(workspaceId);
  const [leaving, setLeaving] = useState<Member | null>(null);
  const isOwner = role === 'owner';

  function confirmRemove(member: Member) {
    remove.mutate(member.userId, {
      onSuccess: () => {
        setLeaving(null);
        if (member.userId === userId) router.push('/workspaces');
        else toast({ title: `${member.name} was removed`, variant: 'success' });
      },
    });
  }

  return (
    <section aria-labelledby="members-title" className={styles.section}>
      {/* the page header names the page; the section keeps its name for screen readers */}
      <VisuallyHidden>
        <h2 id="members-title">Members</h2>
      </VisuallyHidden>

      {isOwner && <AddMemberForm workspaceId={workspaceId} />}

      {members.isPending && <Skeleton height="4rem" />}
      {members.error && (
        <Alert variant="danger" title="Could not load the members">
          {members.error.message}
        </Alert>
      )}
      {changeRole.error && (
        <Alert variant="danger" title="Could not change the role">
          {changeRole.error.message}
        </Alert>
      )}

      <ul className={styles.list}>
        {members.data?.map((member) => {
          const isSelf = member.userId === userId;
          const manageable = member.role !== 'owner';
          return (
            <li key={member.userId} className={styles.row}>
              <Avatar name={member.name} />
              <div className={styles.who}>
                <span className={styles.name}>
                  {member.name}
                  {isSelf && ' (you)'}
                </span>
                {member.email && <span className={styles.email}>{member.email}</span>}
              </div>

              {isOwner && manageable ? (
                <div className={styles.role}>
                  <Select
                    aria-label={`Role for ${member.name}`}
                    size="sm"
                    value={member.role}
                    onChange={(event) =>
                      changeRole.mutate({
                        userId: member.userId,
                        role: memberRoleSchema.parse(event.target.value),
                      })
                    }
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </Select>
                </div>
              ) : (
                <Badge variant={member.role === 'owner' ? 'accent' : 'neutral'}>
                  {member.role}
                </Badge>
              )}

              {manageable && (isOwner || isSelf) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={isSelf ? 'Leave workspace' : `Remove ${member.name}`}
                  onClick={() => setLeaving(member)}
                >
                  {isSelf ? 'Leave' : 'Remove'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        role="alertdialog"
        size="sm"
      >
        <DialogHeader>
          <DialogTitle>
            {leaving?.userId === userId ? 'Leave this workspace?' : `Remove ${leaving?.name}?`}
          </DialogTitle>
          <DialogDescription>
            {leaving?.userId === userId
              ? 'You will lose access to its documents until the owner adds you again.'
              : 'They will lose access to this workspace straight away.'}
          </DialogDescription>
        </DialogHeader>
        {remove.error && (
          <DialogBody>
            <Alert variant="danger" title="Could not do that">
              {remove.error.message}
            </Alert>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setLeaving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => leaving && confirmRemove(leaving)}
          >
            {leaving?.userId === userId ? 'Leave' : 'Remove'}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}
