'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Breadcrumbs } from '@yashwanthvarma74/react/components/Breadcrumbs';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { FormField } from '@yashwanthvarma74/react/components/FormField';
import { Input } from '@yashwanthvarma74/react/components/Input';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useConversations, useCreateConversation, useRequireUser } from '@/lib/queries';
import styles from './ChatList.module.css';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function ChatList({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { loading: signingIn } = useRequireUser();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const conversations = useConversations(workspaceId, search);
  const create = useCreateConversation(workspaceId);

  if (signingIn) return <Skeleton height="6rem" />;

  const start = () =>
    create.mutate(undefined, {
      onSuccess: (conversation) => router.push(`/w/${workspaceId}/chat/${conversation.id}`),
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSearch(typed.trim());
  }

  return (
    <section aria-labelledby="chat-title" className={styles.page}>
      <Breadcrumbs
        items={[
          { label: 'Workspaces', href: '/workspaces' },
          { label: 'Workspace', href: `/w/${workspaceId}` },
          { label: 'Conversations' },
        ]}
      />
      <div className={styles.heading}>
        <h1 id="chat-title">Conversations</h1>
        <Button variant="primary" loading={create.isPending} onClick={start}>
          New conversation
        </Button>
      </div>

      <form className={styles.search} onSubmit={submit} role="search">
        <FormField
          label="Search conversations"
          description="Searches titles and everything said in them."
        >
          <Input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        </FormField>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {create.error && (
        <Alert variant="danger" title="Could not start a conversation">
          {create.error.message}
        </Alert>
      )}
      {conversations.isPending && <Skeleton height="5rem" />}
      {conversations.error && (
        <Alert variant="danger" title="Could not load your conversations">
          {conversations.error.message}
        </Alert>
      )}

      {conversations.data?.length === 0 && (
        <EmptyState
          title={search ? 'No conversations match' : 'No conversations yet'}
          description={
            search ? `Nothing said so far contains "${search}".` : 'Ask a question to start one.'
          }
          action={search ? undefined : <Button onClick={start}>New conversation</Button>}
        />
      )}

      {conversations.data && conversations.data.length > 0 && (
        <ul className={styles.list}>
          {conversations.data.map((conversation) => (
            <li key={conversation.id} className={styles.row}>
              <div className={styles.main}>
                <Link href={`/w/${workspaceId}/chat/${conversation.id}`} className={styles.title}>
                  {conversation.title}
                </Link>
                <span className={styles.meta}>
                  {conversation.mine ? 'You' : conversation.authorName} ·{' '}
                  {when(conversation.updatedAt)}
                </span>
              </div>
              {conversation.visibility === 'workspace' && (
                <Badge variant="info">{conversation.mine ? 'Shared' : 'Shared with you'}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
