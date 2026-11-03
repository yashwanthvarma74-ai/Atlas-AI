import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkPages, chunkText, estimateTokens } from './chunk';

const options = { targetTokens: 50, overlapTokens: 10 };
const limit = options.targetTokens * 4;

const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe('chunkText', () => {
  it('keeps short text in one chunk', () => {
    expect(chunkText('One short paragraph.', options)).toEqual(['One short paragraph.']);
  });

  it('returns nothing for empty or blank text', () => {
    expect(chunkText('', options)).toEqual([]);
    expect(chunkText('  \n\n \n ', options)).toEqual([]);
  });

  it('breaks on paragraphs before it breaks on sentences', () => {
    const first = 'The first paragraph is about revenue. '.repeat(4).trim();
    const second = 'The second paragraph is about costs. '.repeat(4).trim();
    const chunks = chunkText(`${first}\n\n${second}`, { targetTokens: 45, overlapTokens: 0 });
    expect(chunks).toEqual([first, second]);
  });

  it('starts a new unit at a Markdown heading', () => {
    const chunks = chunkText(
      `${'intro '.repeat(20).trim()}\n# Results\n${'detail '.repeat(20).trim()}`,
      {
        targetTokens: 40,
        overlapTokens: 0,
      },
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatch(/^# Results/);
  });

  it('repeats the end of one chunk at the start of the next', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says something.`);
    const chunks = chunkText(sentences.join(' '), { targetTokens: 40, overlapTokens: 12 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const lastWordsOfPrevious = words(chunks[i - 1]!)
        .slice(-3)
        .join(' ');
      expect(chunks[i]).toContain(lastWordsOfPrevious);
    }
  });

  it('does not overlap when asked not to', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Item ${i} is here.`).join(' ');
    const chunks = chunkText(text, { targetTokens: 30, overlapTokens: 0 });
    expect(words(chunks.join(' '))).toEqual(words(text));
  });

  it('cuts a single word longer than a chunk instead of looping or throwing', () => {
    const chunks = chunkText('x'.repeat(1000), options);
    expect(chunks.every((chunk) => chunk.length <= limit)).toBe(true);
    expect(chunks.join('')).toBe('x'.repeat(1000));
  });

  it('never makes a chunk longer than the target, and loses no word', () => {
    const text = fc.array(
      fc.oneof(
        fc.stringMatching(/^[a-z]{1,12}$/),
        fc.constant('.'),
        fc.constant('\n\n'),
        fc.constant('\n# '),
      ),
      { maxLength: 400 },
    );
    fc.assert(
      fc.property(
        text,
        fc.integer({ min: 20, max: 120 }),
        fc.integer({ min: 0, max: 40 }),
        (parts, target, overlap) => {
          const input = parts.join(' ');
          const chunks = chunkText(input, { targetTokens: target, overlapTokens: overlap });

          expect(chunks.every((chunk) => chunk.length <= target * 4)).toBe(true);
          // every word of the input shows up, in order, somewhere in the chunks
          const seen = words(chunks.join(' '));
          let at = 0;
          for (const word of words(input)) {
            at = seen.indexOf(word, at);
            expect(at).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('chunkPages', () => {
  it('keeps every chunk on one page and numbers them in reading order', () => {
    const pages = [
      { page: 1, text: 'Alpha. '.repeat(120) },
      { page: 2, text: 'Beta. '.repeat(120) },
    ];
    const chunks = chunkPages(pages, options);

    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
    expect(chunks.filter((c) => c.page === 1).every((c) => !c.text.includes('Beta'))).toBe(true);
    expect(chunks.filter((c) => c.page === 2).every((c) => !c.text.includes('Alpha'))).toBe(true);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
  });

  it('skips pages with no text, such as a scanned page', () => {
    const chunks = chunkPages(
      [
        { page: 1, text: '   ' },
        { page: 2, text: 'Real text.' },
      ],
      options,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.page).toBe(2);
  });

  it('estimates tokens at four characters each, rounded up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(chunkPages([{ page: 1, text: 'abcdefgh' }], options)[0]?.tokenCount).toBe(2);
  });
});
