'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatStreamEvent, Conversation, Message } from '@atlas/shared';
import { ApiError } from './api';
import { keys } from './queries';
import { streamChat } from './stream';

type Cached = { conversation: Conversation; messages: Message[] };

// The answer being written right now. It lives here, outside the query cache, because it is changing
// several times a second and is not saved yet.
export interface Pending {
  // the question just asked, shown before the server has answered anything; null for a regenerate
  question: string | null;
  content: string;
  // known once the search has finished: what the answer may cite
  sources: { n: number; documentName: string; page: number }[] | null;
  // milliseconds from pressing Send to the first word; shown as soon as it is known
  ttftMs: number | null;
  // true after Stop, until the saved result has been fetched
  stopping: boolean;
}

export interface Chat {
  pending: Pending | null;
  // why the last send was refused or interrupted, in words to show
  error: string | null;
  send(content: string): Promise<boolean>;
  regenerate(): Promise<void>;
  stop(): void;
}

const SAVE_GRACE_MS = 500;

export function useChat(workspaceId: string, conversationId: string): Chat {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // leaving the page while an answer is being written is the same as pressing Stop: the server saves it
  useEffect(() => () => controller.current?.abort(), []);

  const key = keys.conversation(workspaceId, conversationId);

  const run = useCallback(
    async (kind: 'ask' | 'regenerate', question: string | null): Promise<boolean> => {
      const abort = new AbortController();
      controller.current = abort;
      const startedAt = performance.now();
      let userMessageId: string | null = null;
      let finished = false;

      setError(null);
      setPending({ question, content: '', sources: null, ttftMs: null, stopping: false });

      const onEvent = (event: ChatStreamEvent) => {
        switch (event.type) {
          case 'start':
            userMessageId = event.userMessageId;
            break;
          case 'sources':
            setPending((p) => p && { ...p, sources: event.sources });
            break;
          case 'token':
            setPending(
              (p) =>
                p && {
                  ...p,
                  content: p.content + event.text,
                  ttftMs: p.ttftMs ?? Math.round(performance.now() - startedAt),
                },
            );
            break;
          case 'done':
            finished = true;
            // put the finished message in the cache by hand, so nothing flickers while a refetch runs
            queryClient.setQueryData<Cached>(key, (cached) => {
              if (!cached) return cached;
              if (kind === 'regenerate') {
                return { ...cached, messages: [...cached.messages.slice(0, -1), event.message] };
              }
              const asked: Message = {
                id: userMessageId ?? `local-${Date.now()}`,
                role: 'user',
                content: question ?? '',
                status: 'complete',
                error: null,
                citations: [],
                usage: null,
                latency: null,
                createdAt: new Date().toISOString(),
              };
              return { ...cached, messages: [...cached.messages, asked, event.message] };
            });
            setPending(null);
            // the title may have been set by the first question, and the history is ordered by activity
            void queryClient.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
            break;
        }
      };

      try {
        const path = `/workspaces/${workspaceId}/conversations/${conversationId}`;
        await streamChat(
          kind === 'ask' ? `${path}/messages` : `${path}/regenerate`,
          kind === 'ask' ? { content: question } : undefined,
          { signal: abort.signal, onEvent },
        );
        return true;
      } catch (caught) {
        if (abort.signal.aborted) {
          // Stop: the server noticed the closed connection and is saving what had arrived. Give it a
          // moment, then show what it saved.
          setPending((p) => p && { ...p, stopping: true });
          await new Promise((resolve) => setTimeout(resolve, SAVE_GRACE_MS));
          await queryClient.invalidateQueries({ queryKey: key });
          setPending(null);
          return true;
        }
        if (userMessageId === null) {
          // refused before anything started: nothing was saved, so the question goes back to the person
          setPending(null);
          setError(
            caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.',
          );
          return false;
        }
        // the connection broke part-way: whatever the server finished is saved, so show that
        setError('The connection was lost while the answer was being written.');
        await queryClient.invalidateQueries({ queryKey: key });
        setPending(null);
        return true;
      } finally {
        if (!finished) setPending((p) => (p?.stopping ? p : null));
        if (controller.current === abort) controller.current = null;
      }
    },
    [queryClient, workspaceId, conversationId, key],
  );

  return {
    pending,
    error,
    send: (content) => run('ask', content),
    regenerate: async () => void (await run('regenerate', null)),
    stop: () => controller.current?.abort(),
  };
}
