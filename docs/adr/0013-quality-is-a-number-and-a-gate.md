# 0013. Quality is a number, and a change that lowers it does not merge

Status: accepted

## Context

"It looks smart" is not evidence. Retrieval quality, citation honesty and tenant isolation each need a number that
is produced the same way every time, and a rule that stops a change from making them worse.

## Decision

- **A labelled benchmark** (`apps/eval/data`): 30 generated documents of near-identical facts and 276 questions: 120
  in the document's own words, 120 paraphrased, 36 the documents cannot answer. A label is the exact answer
  sentence inside a named document, not a chunk id, so it stays valid when chunk sizes change. It is generated from
  a seed, and a test checks the files in the repository are exactly what the generator produces and that every
  label occurs once in its document.
- **A run** (`npm run run -w @atlas/eval`) builds a throwaway database, ingests the corpus into two workspaces (the
  second holds an identical copy, so a missing filter has something to leak), asks every question, writes an answer
  to each, and removes everything. It reports recall@1/5/10 (split by same-words and paraphrased), citation consistency, cross-workspace hits, p50 and p95 for search, first word and
  whole answer, tokens, and cost per answer.
- **A gate** (`npm run check`): fails when recall@10 falls by more than a point, either question kind by more than
  two, citation consistency below 95% (or more than a point under its baseline), or when a
  single passage from another workspace is retrieved. Speed and cost are reported and not gated, because they depend
  on the machine and a gate that fails on a busy laptop teaches people to ignore it.
- **Runs are recorded** (`--record`) in `eval_runs` and shown on the Evaluation page against the spec's targets,
  including the ones that are not met.

## What it found

Chunk size, overlap and reranker were chosen from a sweep, not from habit (full table in
[EVALUATION.md](../EVALUATION.md)): recall@10 went from 71.7% to 89.2%. The 0.90 recall target is **not met** on this benchmark
with the offline embedder, and the page says so.

## What it cannot tell you

- The corpus is generated from templates. It tests telling near-identical sentences apart and finding the right page,
  not reading messy real documents. Real documents belong in the set when someone brings them.
- The default embedder matches shared words and the default model quotes its sources, so paraphrase recall and
  citation consistency say little about a real model. Both are measured by the same harness the moment a real
  embedder and model are configured, and the config of each run records which was used.
- Citation consistency is a lexical proxy: it catches a citation that points at an unrelated passage and cannot catch
  a related one that says the opposite.

## Alternatives

- **A hosted evaluation service.** Good, and another thing to trust and pay for; the point here is a harness that can
  be read.
- **An LLM judge for answers.** Needs a model and has its own error rate; it is the next addition once one is configured.
