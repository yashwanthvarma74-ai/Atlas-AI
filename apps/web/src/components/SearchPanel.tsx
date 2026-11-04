'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { FormField } from '@yashwanthvarma74/react/components/FormField';
import { Input } from '@yashwanthvarma74/react/components/Input';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { VisuallyHidden } from '@yashwanthvarma74/react/components/VisuallyHidden';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { QUESTION_MAX_LENGTH, type SearchSource } from '@atlas/shared';
import { useCreateConversation, useSearch } from '@/lib/queries';
import { stashQuestion } from '@/lib/ask';
import PassageDialog from './PassageDialog';
import styles from './SearchPanel.module.css';

const SNIPPET_LENGTH = 320;

const snippet = (text: string) =>
  text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH).trimEnd()}…` : text;

export default function SearchPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const search = useSearch(workspaceId);
  const create = useCreateConversation(workspaceId);
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<SearchSource | null>(null);

  // The question opens a new conversation, which asks it as soon as it loads and streams the explained answer.
  function ask(event: FormEvent) {
    event.preventDefault();
    const question = query.trim();
    if (!question) return;
    create.mutate(undefined, {
      onSuccess: (conversation) => {
        stashQuestion(conversation.id, question);
        router.push(`/w/${workspaceId}/chat/${conversation.id}`);
      },
    });
  }

  function findPassages() {
    if (query.trim()) search.mutate(query);
  }

  const sources = search.data;

  return (
    <section aria-labelledby="search-title" className={styles.section}>
      <h2 id="search-title">Ask your documents</h2>

      <form className={styles.form} onSubmit={ask} role="search">
        <FormField
          label="Your question"
          description="Ask gets an explained answer that cites the pages it used. Find passages shows the matching text itself."
        >
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={QUESTION_MAX_LENGTH}
            autoComplete="off"
          />
        </FormField>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Ask
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={search.isPending}
            onClick={findPassages}
          >
            Find passages
          </Button>
        </div>
      </form>
      {create.error && (
        <Alert variant="danger" title="Could not start a conversation">
          {create.error.message}
        </Alert>
      )}

      <VisuallyHidden role="status" aria-live="polite">
        {sources && `${sources.length} ${sources.length === 1 ? 'passage' : 'passages'} found`}
      </VisuallyHidden>

      {search.isPending && <Skeleton height="5rem" />}
      {search.error && (
        <Alert variant="danger" title="Could not search">
          {search.error.message}
        </Alert>
      )}
      {sources?.length === 0 && (
        <p className={styles.empty}>
          No passages matched. Documents that are still processing cannot be searched yet.
        </p>
      )}

      {sources && sources.length > 0 && (
        <ol className={styles.results} aria-label="Matching passages">
          {sources.map((source) => (
            <li key={source.chunkId} className={styles.result}>
              <div className={styles.head}>
                <Badge variant="accent">S{source.n}</Badge>
                <span className={styles.where}>
                  {source.documentName}, page {source.page}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Show in context: S${source.n}`}
                  onClick={() => setOpened(source)}
                >
                  Show in context
                </Button>
              </div>
              <p className={styles.text}>{snippet(source.text)}</p>
            </li>
          ))}
        </ol>
      )}

      <PassageDialog workspaceId={workspaceId} source={opened} onClose={() => setOpened(null)} />
    </section>
  );
}
