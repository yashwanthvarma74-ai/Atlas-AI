# Evaluation

How retrieval and answers are measured, what the numbers were, and what they do not show. Run it with
`docker compose up -d` and `npm run check -w @atlas/eval`.

## The benchmark

30 generated operations documents (720 near-identical facts, three pages each) and 240 questions: 120 in the
document's own words and 120 paraphrased. A label is the exact answer sentence inside a
named document, so it stays valid when chunk sizes change. It is generated from templates (`apps/eval/src/generate.ts`,
seeded and reproducible). It tests whether retrieval can tell near-identical sentences apart. It does not test
reading real, messy documents.

## Results (hash embedder, extractive model)

| Setting                      | recall@10 | same words | paraphrased |
| ---------------------------- | --------- | ---------- | ----------- |
| Old defaults (256, 32, none) | 71.7%     | 88.3%      | 55.0%       |
| **Chosen (64, 0, coverage)** | **89.2%** | 92.5%      | 85.8%       |
| 32 tokens, coverage (best)   | 94.2%     | 98.3%      | 90.0%       |
| 24 tokens, coverage          | 53.8%     | 50.8%      | 56.7%       |

- **Chunk size 64, no overlap.** 32 scores higher but is one sentence, which suits this corpus and starves real
  documents of context. 24 collapses because chunks shorter than the answer sentence cut it in two. The rule used:
  the smallest size that holds the longest answer sentence plus a neighbour (30 tokens, so 59, so 64).
- **Overlap does not help** at any size tested. **The coverage reranker helps at every size**, so it is now the default.
- **Citation consistency is 100% and means little here.** The extractive model quotes its sources, so it cannot
  cite wrongly. The check is meaningful only with a real model.
- Cross-workspace hits: 0. Speed (search and first word, a few milliseconds) is the offline stand-ins' and says nothing
  about a real model.

## The gate

`npm run check -w @atlas/eval` compares a run to `apps/eval/baseline.json` and fails on a drop in recall, citation
consistency below 95%, or any cross-workspace hit. Latency and cost are reported, not gated.
