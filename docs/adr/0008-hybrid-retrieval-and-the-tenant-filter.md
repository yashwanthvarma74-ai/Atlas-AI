# 0008. Hybrid retrieval, and a tenant filter that is tested at every layer

Status: accepted

## Context

Embeddings find passages that mean something close to the question and miss exact names and codes ("INV-20931").
Keyword search is the reverse. The spec asks for both, merged, with the workspace filter added by server code.

## Decision

`retrieve(core, access, question)` does this, in order:

1. Embed the question. A question with no word characters ("???") embeds to a zero vector, which cosine similarity
   rejects, so the vector search is skipped for it and only keywords run.
2. Run a **vector search** and a **keyword search** in parallel, each returning up to 30 candidates
   (`RETRIEVAL_POOL`). The keyword search uses the question's content words, so "what is the status of INV-20931"
   looks for `status`, `inv` and `20931`, not for "what" and "is".
3. Merge the two ranked lists with **reciprocal rank fusion** (k = 60). It needs no score scaling, which is the point:
   a cosine similarity and a keyword relevance score cannot be added.
4. Optionally **rerank** (`RERANKER`). `none` keeps the fused order; `coverage` boosts passages that contain the
   question's own terms. The default is now `coverage`: the week 5 sweep showed it raising recall@10 at every chunk size.
5. Keep the top 8 (`RETRIEVAL_LIMIT`), look up each document's name, and number them **S1 to S8**.

**The tenant filter has three layers, and each is tested on its own:**

- The vector search filters on `workspaceId` inside `$vectorSearch`.
- The keyword search filters on `workspaceId` inside `$search`.
- The name lookup at the end repeats the workspace filter, so a chunk without a document in this workspace is not
  a source.

The `workspaceId` always comes from the `WorkspaceAccess` proof ([0001](0001-workspace-access-is-proved-by-a-type.md)),
never from the request or the model. A document filter supplied by the caller is added with AND, never in place of
the workspace filter.

## What testing the filter taught

The first isolation suite passed, and mutation testing showed it was weak. With the workspace filter deleted from the
keyword search, the suite still passed: the third layer silently dropped the leaked chunks, so a missing primary
filter was invisible. Three of four mutations went uncaught.

The fix is that `vectorSearch` and `keywordSearch` are exported, and the suite attacks each stage directly. Now every
one of these changes fails a named test:

| Mutation                                                | Caught by                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| vector search without the workspace filter              | the vector stage test, the document filter test, and one more |
| keyword search without the workspace filter             | the keyword stage test and the document filter test           |
| document filter replaces the workspace filter (vector)  | the document filter test                                      |
| document filter replaces the workspace filter (keyword) | the document filter test                                      |

Defence in depth is only worth having if each layer is checked separately; otherwise it hides the failure of the
layers above it.

The suite also found a real bug: a question like `*` made the vector search throw. That is what the zero-vector
rule in step 1 is for.

## Evidence

- `isolation.test.ts`: two workspaces with identical text and one secret. Each search stage alone, then `retrieve`,
  against unmodified queries, the secret's exact words and code, queries shaped like operators and injections
  (`{"$ne": null}`, the other workspace's id, quotes, NUL bytes, 400 characters), a document filter naming the other
  workspace's documents, and a fast-check property over random questions and limits in both directions: **0
  cross-workspace retrievals**.
- `retrieve.test.ts` shows each half carrying the other: an exact code found with an embedder that knows nothing
  (keyword rescues the vector side), and a passage found with no shared word (vector rescues the keyword side).

## Consequences

- **There is no relevance cutoff, and week 5 found that none works.** An unanswerable question differs from an answerable one by one entity, which similarity cannot see: the threshold that rejected 11% of unanswerable questions cost 28 points of recall (see [EVALUATION.md](../EVALUATION.md)). `RETRIEVAL_MIN_SCORE` exists and is off. Original note: Nearest-neighbour search always returns neighbours, so a question the documents
  cannot answer still gets 8 passages (fewer in a small workspace). A threshold has to be calibrated against real
  embeddings, and the evaluation set in week 5 is where that happens. Until then the answer step must not treat
  "got sources" as "has an answer".
- The default embedder (`hash`) matches shared words only. The semantic half is exercised by tests with a stand-in
  that groups synonyms, and by real models only once Ollama or OpenAI is configured.
- Two searches per question, and an embedding call, so the route is rate limited (30 a minute per address).

## Alternatives

- **Vector search only.** Misses codes and names, which are exactly what people search for in business documents.
- **Weighted score blending.** Needs scores on one scale and a weight to tune. Rank fusion has no weights.
- **Filtering after the search.** A filter applied to the top 30 can leave 0 results for a small workspace in a large
  database. Filtering inside the search returns the best 30 of this workspace's passages.
