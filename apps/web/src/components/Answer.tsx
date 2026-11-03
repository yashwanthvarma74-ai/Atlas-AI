'use client';

import { createContext, useContext, type ComponentProps } from 'react';
import Markdown, { type Components } from 'react-markdown';
import type { Citation } from '@atlas/shared';
import styles from './Answer.module.css';

interface Props {
  content: string;
  // Which numbers the answer may cite. While it streams these come from the search results; once it is
  // finished they come from the saved citations. A number outside the list is not shown as a citation.
  known: { n: number; documentName: string; page: number }[];
  // present once the answer is saved: only then does a citation have a passage to open
  citations?: Citation[];
  onOpen?: (citation: Citation) => void;
}

const MARKERS = /\[\s*(S\d+(?:\s*,\s*S\d+)*)\s*\]/g;

// Turns "[S1, S3]" into two Markdown links, "[S1](#cite-1) [S3](#cite-3)", which the renderer below draws as
// chips. A number that was never offered is dropped here, so a wrong one cannot look like a source even in
// the moments before the server has checked the answer.
function withCitationLinks(content: string, known: Set<number>): string {
  return content.replace(MARKERS, (_marker, group: string) =>
    group
      .split(',')
      .map((part) => Number(part.trim().slice(1)))
      .filter((n) => known.has(n))
      .map((n) => `[S${n}](#cite-${n})`)
      .join(' '),
  );
}

interface CitationLookup {
  info: Map<number, { documentName: string; page: number }>;
  byNumber: Map<number, Citation>;
  onOpen?: (citation: Citation) => void;
}

// The renderers below are defined once, outside any component. If they were made during each render, React
// would see a new component type every time and throw away every chip and draw it again, which drops the
// keyboard focus from a chip whenever anything on the page refreshes. What they need to know travels in
// context instead.
const CitationContext = createContext<CitationLookup>({ info: new Map(), byNumber: new Map() });

function CitationLink({ href, children }: ComponentProps<'a'>) {
  const { info, byNumber, onOpen } = useContext(CitationContext);
  const n = /^#cite-(\d+)$/.exec(href ?? '')?.[1];
  // any other link is shown as its text, not as a link
  if (!n) return <>{children}</>;

  const source = info.get(Number(n));
  const citation = byNumber.get(Number(n));
  const label = `Source S${n}${source ? `: ${source.documentName}, page ${source.page}` : ''}`;
  return citation && onOpen ? (
    <button
      type="button"
      className={styles.chip}
      aria-label={label}
      onClick={() => onOpen(citation)}
    >
      S{n}
    </button>
  ) : (
    // still being written: it names its source but there is nothing to open yet
    <span className={styles.chip} role="img" aria-label={label}>
      S{n}
    </span>
  );
}

// A model's output is untrusted text. It may be formatted, and it may cite, and that is all: it cannot add
// pictures (a way to send data to another site by URL) or links (a way to send the reader there).
const COMPONENTS: Components = {
  img: () => null,
  a: CitationLink,
};

export default function Answer({ content, known, citations, onOpen }: Props) {
  const numbers = new Set(known.map((k) => k.n));
  const lookup: CitationLookup = {
    info: new Map(known.map((k) => [k.n, k])),
    byNumber: new Map(citations?.map((c) => [c.n, c])),
    onOpen,
  };

  return (
    <CitationContext.Provider value={lookup}>
      <div className={styles.answer}>
        <Markdown components={COMPONENTS}>{withCitationLinks(content, numbers)}</Markdown>
      </div>
    </CitationContext.Provider>
  );
}
