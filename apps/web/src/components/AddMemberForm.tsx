'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { FormField } from '@yashwanthvarma74/react/components/FormField';
import { Input } from '@yashwanthvarma74/react/components/Input';
import { Select } from '@yashwanthvarma74/react/components/Select';
import { useToast } from '@yashwanthvarma74/react/components/Toast';
import { useState, type FormEvent } from 'react';
import { memberRoleSchema, type MemberRole } from '@atlas/shared';
import { useAddMember } from '@/lib/queries';
import styles from './MemberList.module.css';

export default function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();
  const add = useAddMember(workspaceId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate(
      { email, role },
      {
        onSuccess: (member) => {
          setEmail('');
          toast({ title: `${member.name} was added as ${member.role}`, variant: 'success' });
        },
      },
    );
  }

  return (
    <form className={styles.add} onSubmit={submit}>
      <FormField label="Add someone by email" description="They need an Atlas AI account first.">
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="off"
          required
        />
      </FormField>
      <FormField label="Role">
        <Select
          value={role}
          onChange={(event) => setRole(memberRoleSchema.parse(event.target.value))}
        >
          <option value="viewer">Viewer: can read and ask</option>
          <option value="editor">Editor: can also add documents</option>
        </Select>
      </FormField>
      <Button type="submit" variant="secondary" loading={add.isPending}>
        Add
      </Button>
      {add.error && (
        <div className={styles.addError}>
          <Alert variant="danger" title="Could not add them">
            {add.error.message}
          </Alert>
        </div>
      )}
    </form>
  );
}
