// Small words that appear in nearly every passage and say nothing about relevance.
const STOP_WORDS = new Set(
  'the a an and or of to in on for with by at from as is are was were be been it its this that these those what which who how when where why do does did about into than then'.split(
    ' ',
  ),
);

const WORD = /[\p{L}\p{N}]+/gu;

export const queryTerms = (text: string): string[] => [
  ...new Set(
    [...text.toLowerCase().matchAll(WORD)]
      .map(([word]) => word)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
  ),
];

export interface Rankable {
  text: string;
  // the score the first stage gave it; higher is better
  score: number;
}

export type Reranker = <T extends Rankable>(query: string, candidates: T[]) => T[];

export const noRerank: Reranker = (_query, candidates) => candidates;

// Boosts a passage by the share of the question's terms it actually contains. A passage that is close in
// meaning but never uses the words asked about moves down, and one that names them all moves up. It is
// cheap and has no model to call, so it is a baseline: a cross-encoder or an LLM reranker would replace it
// if the evaluation in week 5 shows it is worth the cost.
export const coverageRerank: Reranker = (query, candidates) => {
  const terms = queryTerms(query);
  if (terms.length === 0 || candidates.length === 0) return candidates;
  const best = Math.max(...candidates.map((c) => c.score));
  return candidates
    .map((candidate) => {
      const words = new Set([...candidate.text.toLowerCase().matchAll(WORD)].map(([w]) => w));
      const coverage = terms.filter((term) => words.has(term)).length / terms.length;
      return { candidate, score: candidate.score / best + coverage };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ candidate, score }) => ({ ...candidate, score }));
};

export const RERANKERS = { none: noRerank, coverage: coverageRerank } as const;
