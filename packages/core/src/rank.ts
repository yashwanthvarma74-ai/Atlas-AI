// Reciprocal rank fusion: each list votes for its items by position, and an item's score is the sum of
// 1 / (k + position) over the lists it appears in. It needs no score scaling, which matters because a
// vector similarity and a keyword relevance score are not on the same scale and cannot be added.
// k = 60 is the value from the original paper; it keeps one first place from dwarfing everything else.
export function reciprocalRankFusion<T>(
  lists: T[][],
  key: (item: T) => string,
  k = 60,
): { item: T; score: number }[] {
  const merged = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const id = key(item);
      const entry = merged.get(id) ?? { item, score: 0 };
      entry.score += 1 / (k + index + 1);
      merged.set(id, entry);
    });
  }
  // equal scores keep the order in which they were first seen, so the result is deterministic
  return [...merged.values()].sort((a, b) => b.score - a.score);
}
