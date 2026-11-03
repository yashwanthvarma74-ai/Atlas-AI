import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './rank';

const fuse = (lists: string[][]) => reciprocalRankFusion(lists, (id) => id);

describe('reciprocalRankFusion', () => {
  it('puts an item that both lists like above one that only one does', () => {
    const merged = fuse([
      ['a', 'b', 'c'],
      ['d', 'b', 'e'],
    ]);
    expect(merged[0]?.item).toBe('b');
  });

  it('keeps one entry per item, however many lists it is in', () => {
    const merged = fuse([['a', 'b'], ['b', 'a'], ['a']]);
    expect(merged.map((m) => m.item).sort()).toEqual(['a', 'b']);
  });

  it('is stable: equal scores keep the order they were first seen in', () => {
    expect(fuse([['a'], ['b']]).map((m) => m.item)).toEqual(['a', 'b']);
  });

  it('handles empty input', () => {
    expect(fuse([])).toEqual([]);
    expect(fuse([[], []])).toEqual([]);
  });

  it('scores the top of a single list 1 / (k + 1)', () => {
    expect(fuse([['a']])[0]?.score).toBeCloseTo(1 / 61, 10);
  });

  it('returns every input item exactly once, best first, for any lists', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 9 }).map(String), { maxLength: 8 })),
        (lists) => {
          const lists2 = lists.map((list) => [...new Set(list)]);
          const merged = fuse(lists2);
          const expected = new Set(lists2.flat());
          expect(merged.map((m) => m.item).sort()).toEqual([...expected].sort());
          for (let i = 1; i < merged.length; i++) {
            expect(merged[i - 1]!.score).toBeGreaterThanOrEqual(merged[i]!.score);
          }
        },
      ),
    );
  });
});
