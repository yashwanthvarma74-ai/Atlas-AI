'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Button } from '@yashwanthvarma74/react/components/Button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@yashwanthvarma74/react/components/Dialog';
import { FormField } from '@yashwanthvarma74/react/components/FormField';
import { Input } from '@yashwanthvarma74/react/components/Input';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { WORKSPACE_NAME_MAX_LENGTH } from '@atlas/shared';
import { useCreateWorkspace } from '@/lib/queries';

export default function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateWorkspace();
  const [name, setName] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(name, {
      onSuccess: (workspace) => {
        setName('');
        onOpenChange(false);
        router.push(`/w/${workspace.id}`);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            A workspace keeps its documents, chats and search results to the people you add.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={WORKSPACE_NAME_MAX_LENGTH}
              autoComplete="off"
            />
          </FormField>
          {create.error && (
            <Alert variant="danger" title="Could not create the workspace">
              {create.error.message}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create workspace
          </Button>
        </DialogFooter>
        <DialogClose />
      </form>
    </Dialog>
  );
}
