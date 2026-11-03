# 0007. Atlas Vector Search and Atlas Search, developed on Atlas Local

Status: accepted

## Context

Retrieval needs a vector index and a full-text index, both able to filter by workspace inside the query. The spec
chooses MongoDB Atlas for both, so passages, vectors and the tenant filter live in one database and there is no
second store to keep in step. A plain `mongod` has neither `$vectorSearch` nor `$search`, and the free Atlas tier
needs an account, a network and credentials that a reviewer cloning the repository does not have.

## Decision

- **Production target: MongoDB Atlas.** The code uses `$vectorSearch`, `$search` and `createSearchIndex`, which
  behave the same on a cluster.
- **Development and CI: the `mongodb-atlas-local` image.** It runs the same database and the same search service
  (`mongot`) in one container, so the retrieval code and its tests run on a laptop and in CI against the real
  engines, not a mock. `docker compose up -d` starts it on port 27018. `directConnection=true` is required
  because its replica set advertises a name only the container can resolve.
- **The app creates its own indexes.** `ensureSearchIndexes` runs when the API or the worker starts and creates
  `chunk_vectors` and `chunk_text` if they are missing. The vector index declares `workspaceId` and `documentId` as
  filter fields; the text index maps `workspaceId` and `documentId` as `objectId` so they can be matched exactly.
- **A database with no search still works, for everything else.** If the search service is not there,
  `searchAvailable` is false, uploading and indexing carry on, and searching answers `503` with the reason. A plain
  `mongod` is therefore still a valid way to run most of the tests.
- **The index is tied to the embedding size.** The vector index is built for `EMBEDDING_DIMENSIONS`. If the setting
  and the index disagree, startup stops with a message, because vectors of two sizes cannot share an index and
  changing the model means re-embedding every document.

## Why

- Developing against the real engines is how the isolation suite (0008) could be written at all. A fake vector
  search would test the fake.
- Creating indexes from the application removes a deployment step that is easy to forget and impossible to
  notice until search returns nothing.

## Consequences

- Search indexes are **eventually consistent**: a chunk becomes searchable a moment after it is written. Users see
  "indexed" slightly before the last passage is searchable. Tests wait for the index to hold exactly as many
  chunks as the database (`waitForIndexes`) rather than sleeping.
- Everything on `mongodb-atlas-local` is a 1.9 GB image and a few seconds of start-up before search answers. The
  test helper waits up to two minutes for a cold start.
- Switching embedding models is a migration, not a setting: drop `chunk_vectors`, change the dimensions, and
  re-process every document (the retry button does one at a time). A bulk re-index command is not built.

## Evidence

- Both index types were created and queried on Atlas Local before any code was written, with the workspace filter,
  as a probe of what the engines support.
- The whole test suite runs against Atlas Local on every change. The suite ran eight times in a row with no
  failures after the wait helper was fixed (see 0008 for what the flakes taught).

## Alternatives

- **Pinecone, Qdrant or pgvector for vectors.** Strong, and a second store to sync and a second place to enforce
  the tenant filter. Revisit at much larger scale.
- **Elasticsearch for keywords.** Same objection, and a heavier thing to run locally.
- **Compute similarity in the application.** Works for a few thousand passages and teaches nothing about the
  system the spec asks for.
