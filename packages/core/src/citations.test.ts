import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractCitations, formatSources, type Source } from './citations';

const source = (n: number, page = n): Source => ({
  n,
  chunkId: `chunk-${n}`,
  documentId: `doc-${n}`,
  documentName: `file-${n}.pdf`,
  page,
  text: `Passage number ${n}, with some words in it.`,
  score: 1,
});
const sources = [source(1), source(2), source(3)];

describe('extractCitations', () => {
  it('maps a number back to its document, page and passage', () => {
    const { citations } = extractCitations('Revenue grew [S2].', sources);
    expect(citations).toEqual([
      {
        n: 2,
        chunkId: 'chunk-2',
        documentId: 'doc-2',
        documentName: 'file-2.pdf',
        page: 2,
        quote: 'Passage number 2, with some words in it.',
      },
    ]);
  });

  it('drops a number the server never issued, from the text and from the citations', () => {
    const { text, citations } = extractCitations('Grew [S2] and shrank [S9].', sources);
    expect(text).toBe('Grew [S2] and shrank.');
    expect(citations.map((c) => c.n)).toEqual([2]);
  });

  it('keeps the valid numbers of a group and drops the rest', () => {
    const { text, citations } = extractCitations('Both [S1, S7, S3] agree.', sources);
    expect(text).toBe('Both [S1, S3] agree.');
    expect(citations.map((c) => c.n)).toEqual([1, 3]);
  });

  it('lists each source once, in the order it first appears', () => {
    const { citations } = extractCitations('A [S3]. B [S1]. C [S3] [S1] [S2].', sources);
    expect(citations.map((c) => c.n)).toEqual([3, 1, 2]);
  });

  it('leaves text with no markers alone', () => {
    expect(extractCitations('No sources needed.', sources)).toEqual({
      text: 'No sources needed.',
      citations: [],
    });
  });

  it('does not treat other bracketed text as a citation', () => {
    const { text, citations } = extractCitations(
      'See [1], [Smith 2020] and [S] and [SX2].',
      sources,
    );
    expect(text).toBe('See [1], [Smith 2020] and [S] and [SX2].');
    expect(citations).toEqual([]);
  });

  it('refuses every number when there are no sources at all', () => {
    const { text, citations } = extractCitations('Made up [S1].', []);
    expect(text).toBe('Made up.');
    expect(citations).toEqual([]);
  });

  it('never cites anything outside the issued numbers, whatever the model writes', () => {
    const marker = fc.oneof(
      fc.integer({ min: 0, max: 20 }).map((n) => `[S${n}]`),
      fc
        .array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 4 })
        .map((ns) => `[${ns.map((n) => `S${n}`).join(', ')}]`),
      fc.string({ maxLength: 12 }),
    );
    fc.assert(
      fc.property(fc.array(marker, { maxLength: 30 }), (parts) => {
        const { text, citations } = extractCitations(parts.join(' '), sources);
        expect(citations.every((c) => [1, 2, 3].includes(c.n))).toBe(true);
        for (const [, n] of text.matchAll(/\[S(\d+)\]/g)) expect([1, 2, 3]).toContain(Number(n));
        for (const [, group] of text.matchAll(/\[(S\d+(?:, S\d+)+)\]/g)) {
          for (const n of group!.match(/\d+/g)!) expect([1, 2, 3]).toContain(Number(n));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('formatSources', () => {
  it('shows the model a number and the words, and no file name or page', () => {
    const shown = formatSources(sources);
    expect(shown).toContain('[S1]\nPassage number 1');
    expect(shown).not.toMatch(/file-\d|doc-\d|chunk-\d|page/i);
  });
});
