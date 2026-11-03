// A passage the model may cite. The model is shown only `n` and `text`; everything else stays on the server,
// which is what makes a citation something the model can point at but cannot invent.
export interface Source {
  n: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  page: number;
  text: string;
  score: number;
}

export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  page: number;
  // the start of the passage, for showing next to the answer
  quote: string;
}

const QUOTE_LENGTH = 240;

// How sources are shown to the model: a number and the words, nothing it could mistake for an address.
export function formatSources(sources: Source[]): string {
  return sources.map((source) => `[S${source.n}]\n${source.text}`).join('\n\n');
}

const MARKER_GROUP = /\[\s*(S\d+(?:\s*,\s*S\d+)*)\s*\]/g;

// Reads the [S3] and [S3, S5] markers in an answer and maps each number back to the source it was given.
// A number the server never issued is dropped from the text, so an answer can never point at a document
// it was not shown. Citations come back in the order they first appear, once each.
export function extractCitations(
  answer: string,
  sources: Source[],
): { text: string; citations: Citation[] } {
  const issued = new Map(sources.map((source) => [source.n, source]));
  const cited = new Map<number, Citation>();

  const text = answer
    .replace(MARKER_GROUP, (_match, group: string) => {
      const kept = group
        .split(',')
        .map((part) => Number(part.trim().slice(1)))
        .filter((n) => issued.has(n));
      for (const n of kept) {
        if (cited.has(n)) continue;
        const source = issued.get(n)!;
        cited.set(n, {
          n,
          chunkId: source.chunkId,
          documentId: source.documentId,
          documentName: source.documentName,
          page: source.page,
          quote: source.text.slice(0, QUOTE_LENGTH),
        });
      }
      return kept.length > 0 ? `[${kept.map((n) => `S${n}`).join(', ')}]` : '';
    })
    // removing a marker can leave a doubled space or a space before punctuation
    .replace(/ {2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1');

  return { text, citations: [...cited.values()] };
}
