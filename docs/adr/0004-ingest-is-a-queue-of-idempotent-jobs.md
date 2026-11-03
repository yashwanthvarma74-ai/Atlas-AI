# 0004. Ingest is a queue of idempotent jobs

Status: accepted

## Context

Reading a PDF, splitting it, and embedding every passage takes seconds to minutes and calls an external service
that can be slow, down, or rate limited. An upload request cannot wait for that, and it cannot lose the work if the
server restarts halfway. Users also need to see where their file is.

## Decision

The upload request stores the file, records the document as `queued`, puts a job on a BullMQ queue and answers
`202`. A separate worker process (`apps/worker`) runs `queued → parsing → embedding → indexed` and writes each
status to the document as it goes. The web app polls the document list every 1.5 seconds while anything is in
progress and stops once everything has settled.

Four rules keep it correct:

- **The job id is the document id.** Queueing the same document twice is one job. A retry removes the finished job
  first, so it can run again.
- **A run replaces, never adds.** The chunks for a document are deleted and re-inserted, so a retry after a
  half-finished attempt leaves no duplicates (tested by running a document twice).
- **A job carries ids only, and checks access when it runs.** It calls `requireAccess(..., 'editor')` again at
  the start, so someone removed while their upload waited cannot have it processed on their behalf
  ([0001](0001-workspace-access-is-proved-by-a-type.md)). The document is marked failed with a plain reason.
- **A deleted document stays deleted.** Deleting removes the record first. A worker that is mid-way finds nothing
  to update and removes the chunks it wrote.

Failures are sorted by whether trying again can help:

| Failure                                                        | What happens                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Embedding service unreachable, 429 or 5xx, or a stage timeout  | BullMQ retries, 3 attempts, exponential backoff (2 s, then 4 s)                                                     |
| Damaged file, no text in it, bad API key, uploader lost access | Failed at once, with the reason shown to the user; no retries                                                       |
| Out of attempts                                                | Document `failed` ("failed after 3 attempts"); the job is kept for a week in BullMQ's failed set as the dead letter |

A user can retry any failed document from the UI. A sweep in the worker, once a minute, re-queues any document that
has been `queued` for over two minutes with no job. That covers the process dying between saving the document and
queueing it, or Redis losing the job.

If Redis is down at upload time the request fails with 503 and leaves nothing behind (no record, no stored file).

## Why

- **Status is data, not a side channel.** The document row is the single source of truth, so a page reload, a
  second browser tab and the worker all agree. No socket state to lose.
- **Polling over push for now.** Documents change a few times a minute. Server-Sent Events arrive with chat in
  week 4, and the list can adopt them if polling ever shows up in a trace.
- **Per-stage timeouts** (120 s, `INGEST_STAGE_TIMEOUT_MS`) turn a hung provider into a retry instead of a job that
  holds a worker slot for ever.

## Evidence

- `worker.test.ts` runs a real BullMQ worker against real Redis and MongoDB: upload to indexed with no help, a
  temporary failure that recovers on the second attempt, three attempts then `failed` with the job in the failed
  set, a permanent failure that runs once, a user retry, and the stale sweep (including running it twice).
- `ingest.test.ts` covers the race with deletion, the removed uploader, and the timeout.

## Consequences

- Two processes to run (`npm run dev` starts both) and a Redis to run them against.
- A stage timeout cannot interrupt synchronous work inside the PDF parser. It protects against a stuck network
  call, not against a PDF that spins the CPU. The 20 MB and 500 page limits bound that case.
- Backoff is configurable (`INGEST_BACKOFF_MS`) so tests do not wait seconds for retries.

## Alternatives

- **Do the work in the request.** Simple, and it ties up a connection for as long as the slowest file.
- **A Mongo-backed job collection.** Fewer moving parts, but no retries, backoff or dead letters without writing
  them, and the spec names BullMQ.
- **Server-Sent Events for status now.** More moving parts than the numbers justify at this stage.
