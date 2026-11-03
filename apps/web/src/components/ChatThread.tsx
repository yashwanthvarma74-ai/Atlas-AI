'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Breadcrumbs } from '@yashwanthvarma74/react/components/Breadcrumbs';
import { Button } from '@yashwanthvarma74/react/components/Button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@yashwanthvarma74/react/components/Dialog';
import { EmptyState } from '@yashwanthvarma74/react/components/EmptyState';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { Switch } from '@yashwanthvarma74/react/components/Switch';
import { VisuallyHidden } from '@yashwanthvarma74/react/components/VisuallyHidden';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Citation, Message, SearchSource } from '@atlas/shared';
import { ApiError } from '@/lib/api';
import {
  useConversation,
  useDeleteConversation,
  useRequireUser,
  useUpdateConversation,
  useWorkspace,
} from '@/lib/queries';
import { useChat } from '@/lib/useChat';
import { AssistantMessage, PendingAnswer, UserMessage } from './ChatMessage';
import ToolCallCard from './ToolCallCard';
import ChatComposer from './ChatComposer';
import MessageBoundary from './MessageBoundary';
import PassageDialog from './PassageDialog';
import styles from './ChatThread.module.css';

// one array for every render before the conversation has loaded, so effects that depend on it do not re-run
const NO_MESSAGES: Message[] = [];

// The passage dialog shows a search result; a citation has the same facts, with the start of the passage
// as its text.
const asSource = (citation: Citation): SearchSource => ({
  n: citation.n,
  chunkId: citation.chunkId,
  documentId: citation.documentId,
  documentName: citation.documentName,
  page: citation.page,
  text: citation.quote,
  score: 0,
});

export default function ChatThread({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const router = useRouter();
  const { loading: signingIn } = useRequireUser();
  const conversation = useConversation(workspaceId, conversationId);
  const workspace = useWorkspace(workspaceId);
  const update = useUpdateConversation(workspaceId, conversationId);
  const remove = useDeleteConversation(workspaceId);
  const chat = useChat(workspaceId, conversationId);
  const [opened, setOpened] = useState<SearchSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const messages = conversation.data?.messages ?? NO_MESSAGES;
  const { pending } = chat;
  const isPending = pending !== null;
  const streamed = pending?.content;
  const count = messages.length;

  // keep the newest words in view while an answer is written, and when a new message is added
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [count, streamed, isPending]);

  // The words are not read out as they stream (that would be a stream of fragments); the person is told
  // when the answer starts and when it ends.
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending && !wasPending.current) setAnnouncement('Searching your documents');
    if (!pending && wasPending.current) {
      const last = messages.at(-1);
      setAnnouncement(
        last?.status === 'stopped'
          ? 'Answer stopped'
          : last?.status === 'failed'
            ? 'The answer failed'
            : 'Answer ready',
      );
    }
    wasPending.current = isPending;
  }, [pending, isPending, messages]);

  if (signingIn || conversation.isPending) return <Skeleton height="10rem" />;

  if (conversation.error || !conversation.data) {
    const missing = conversation.error instanceof ApiError && conversation.error.status === 404;
    return (
      <EmptyState
        title={missing ? 'Conversation not found' : 'Could not load this conversation'}
        description={
          missing
            ? 'It may have been deleted, or it is private to someone else.'
            : (conversation.error?.message ?? 'Try again in a moment.')
        }
        action={<Link href={`/w/${workspaceId}/chat`}>Back to your conversations</Link>}
      />
    );
  }

  const { conversation: info, toolCalls } = conversation.data;
  // approving needs the conversation to be yours and a role that may use the tool; the server checks both again
  const mayApprove =
    info.mine && (workspace.data?.role === 'editor' || workspace.data?.role === 'owner');
  const lastIndex = messages.length - 1;
  // while a regenerate is running the old answer is hidden, and its replacement shown as pending
  const shown = pending && pending.question === null ? messages.slice(0, -1) : messages;

  return (
    <div className={styles.page}>
      <Breadcrumbs
        items={[
          { label: 'Workspaces', href: '/workspaces' },
          { label: 'Workspace', href: `/w/${workspaceId}` },
          { label: 'Conversations', href: `/w/${workspaceId}/chat` },
          { label: info.title },
        ]}
      />

      <div className={styles.heading}>
        <h1>{info.title}</h1>
        {info.mine ? (
          <div className={styles.controls}>
            <Switch
              checked={info.visibility === 'workspace'}
              disabled={update.isPending}
              onChange={(event) =>
                update.mutate(
                  { visibility: event.target.checked ? 'workspace' : 'private' },
                  { onSuccess: () => void conversation.refetch() },
                )
              }
            >
              Share with workspace
            </Switch>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </div>
        ) : (
          <Badge variant="info">Shared by {info.authorName}</Badge>
        )}
      </div>

      <MessageBoundary>
        <ol className={styles.messages} aria-label="Conversation">
          {shown.map((message, index) => (
            <MessageBoundary key={message.id}>
              {message.role === 'user' ? (
                <UserMessage content={message.content} />
              ) : (
                <AssistantMessage
                  message={message}
                  canRetry={info.mine && !pending && index === lastIndex}
                  onRetry={() => void chat.regenerate()}
                  onOpen={(citation) => setOpened(asSource(citation))}
                />
              )}
              {toolCalls
                .filter((call) => call.messageId === message.id)
                .map((call) => (
                  <ToolCallCard
                    key={call.id}
                    call={call}
                    workspaceId={workspaceId}
                    conversationId={conversationId}
                    canDecide={mayApprove}
                  />
                ))}
            </MessageBoundary>
          ))}
          {pending?.question && <UserMessage content={pending.question} />}
          {pending && <PendingAnswer pending={pending} />}
        </ol>
      </MessageBoundary>
      <div ref={end} />

      {messages.length === 0 && !pending && (
        <p className={styles.empty}>Ask a question. Answers cite the passages they come from.</p>
      )}

      <VisuallyHidden role="status" aria-live="polite">
        {announcement}
      </VisuallyHidden>

      {chat.error && (
        <Alert variant="danger" title="Could not send that">
          {chat.error}
        </Alert>
      )}

      {info.mine ? (
        <ChatComposer busy={pending !== null} onSend={chat.send} onStop={chat.stop} />
      ) : (
        <p className={styles.empty}>
          You can read this conversation. Only {info.authorName} can add to it.
        </p>
      )}

      <PassageDialog workspaceId={workspaceId} source={opened} onClose={() => setOpened(null)} />

      <Dialog open={deleting} onOpenChange={setDeleting} role="alertdialog" size="sm">
        <DialogHeader>
          <DialogTitle>Delete this conversation?</DialogTitle>
          <DialogDescription>
            Its messages are removed for everyone, including anyone it was shared with.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(conversationId, {
                onSuccess: () => router.push(`/w/${workspaceId}/chat`),
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
