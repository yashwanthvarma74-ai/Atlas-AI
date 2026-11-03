import { describe, expect, it } from 'vitest';
import { coverageRerank, noRerank, queryTerms } from './rerank';

const c = (text: string, score: number) => ({ text, score });

describe('queryTerms', () => {
  it('drops stop words and duplicates and lower-cases', () => {
    expect(queryTerms('What is the Revenue of the revenue?')).toEqual(['revenue']);
  });

  it('keeps codes and numbers, which are what keyword search is for', () => {
    expect(queryTerms('invoice INV-20931')).toEqual(['invoice', 'inv', '20931']);
  });
});

describe('coverageRerank', () => {
  it('moves a passage that contains every term above one that contains few', () => {
    const ranked = coverageRerank('third quarter revenue', [
      c('Costs fell after the consolidation.', 0.02),
      c('Revenue grew in the third quarter.', 0.018),
    ]);
    expect(ranked[0]?.text).toContain('Revenue grew');
  });

  it('keeps the first-stage order when coverage is equal', () => {
    const ranked = coverageRerank('revenue', [c('revenue one', 0.03), c('revenue two', 0.02)]);
    expect(ranked.map((r) => r.text)).toEqual(['revenue one', 'revenue two']);
  });

  it('leaves candidates alone when the query has nothing to match on', () => {
    const input = [c('a', 1), c('b', 0.5)];
    expect(coverageRerank('the of and', input)).toEqual(input);
    expect(coverageRerank('anything', [])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [c('x', 1), c('revenue', 0.9)];
    const copy = structuredClone(input);
    coverageRerank('revenue', input);
    expect(input).toEqual(copy);
  });
});

describe('noRerank', () => {
  it('returns the candidates untouched', () => {
    const input = [c('a', 1)];
    expect(noRerank('q', input)).toBe(input);
  });
});
