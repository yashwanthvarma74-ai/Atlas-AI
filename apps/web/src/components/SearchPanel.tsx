'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Badge } from '@yashwanthvarma74/react/components/Badge';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { FormField } from '@yashwanthvarma74/react/components/FormField';
import { Input } from '@yashwanthvarma74/react/components/Input';
import { Skeleton } from '@yashwanthvarma74/react/components/Skeleton';
import { VisuallyHidden } from '@yashwanthvarma74/react/components/VisuallyHidden';
import { useState, type FormEvent } from 'react';
import { QUESTION_MAX_LENGTH, type SearchSource } from '@atlas/shared';
import { useSearch } from '@/lib/queries';
import PassageDialog from './PassageDialog';
import styles from './SearchPanel.module.css';

const SNIPPET_LENGTH = 320;

const snippet = (text: string) =>
  text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH).trimEnd()}…` : text;

export default function SearchPanel({ workspaceId }: { workspaceId: string }) {
  const search = useSearch(workspaceId);
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<SearchSource | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) search.mutate(query);
  }

  const sources = search.data;

  return (
    <section aria-labelledby="search-title" className={styles.section}>
      <h2 id="search-title">Search</h2>

      <form className={styles.form} onSubmit={submit} role="search">
        <FormField
          label="Search your documents"
          description="Finds passages by meaning and by the exact words and codes you type."
        >
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={QUESTION_MAX_LENGTH}
            autoComplete="off"
          />
        </FormField>
        <Button type="submit" variant="secondary" loading={search.isPending}>
          Search
        </Button>
      </form>

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
                  aria-label={`Show S${source.n} in context`}
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
