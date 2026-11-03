# Atlas AI

A private knowledge copilot: upload your documents, ask questions, and get streamed answers with citations you
can check.

Built by [Yashwanth Varma](https://github.com/yashwanthvarma74-ai) with the
[Meridian design system](https://github.com/yashwanthvarma74-ai/designSystem).

> **Status: week 4 of 6 (chat).** Accounts, workspaces, roles, tenant isolation, the upload-to-indexed pipeline,
> hybrid search, server-owned citations and streaming chat (stop, regenerate, history, sharing) are built and
> tested. Evaluation, cost numbers and agents are **not built yet**; they are drawn dashed below and each is marked
> with the week it lands. It is **not deployed** and the **demo video is not recorded**. The hosted model providers
> have **not been run against their live services** (no key was available); see [ADR 0012](docs/adr/0012-the-model-is-behind-an-interface-and-everything-it-sees-or-says-is-untrusted.md).

## Try it

You need Node 22+ and Docker. `docker compose up -d` starts MongoDB with Atlas Search and Vector Search (the
`mongodb-atlas-local` image, on port 27018) and Redis. A plain `mongod` also works for everything except searching.

```bash
cp .env.example .env
npm install
npm run dev      # web http://localhost:3002, API http://localhost:4002, and the ingest worker
```

Open <http://localhost:3002> and press **Continue as guest**: no sign-up, and you land in a workspace you own. Open
it, upload a PDF, a text or Markdown file, or a PNG or JPEG, and watch it move from queued through parsing and
embedding to indexed. Create a second account, add it to your workspace by email, and watch what a viewer can and
cannot do.

Then open **Conversations** and ask a question. The answer streams in, cites its sources as `S1`, `S2`, ..., and each
citation opens the exact page's passages with the cited one marked. **Stop** keeps what had arrived, **Regenerate**
writes it again, a follow-up like "and costs?" is rewritten into a question that stands alone before it is
searched, and **Share with workspace** lets your colleagues read (not add to) a conversation. The **Search** box
under the documents finds passages directly.

By default passages are embedded with `EMBEDDING_PROVIDER=hash`, which needs no service and no key but matches on
shared words only, not meaning. That is enough to run and test the whole pipeline, and the search code is tested
for meaning with a stand-in embedder that groups synonyms. For real semantic search set `ollama` (local) or
`openai` in `.env`, and see `.env.example`.

The model that writes answers is `LLM_PROVIDER=extractive` by default: it answers by quoting the passages it is given,
so the whole chat works with no key and no service, but it cannot reason or paraphrase. Set `openai`, `anthropic` or
`ollama` for real answers. `EXTRACTIVE_DELAY_MS=40` slows it down so streaming is visible.

```bash
npm test                 # unit, integration and component tests (needs MongoDB)
npm run test:coverage    # coverage for core and the API
npm run lint && npm run typecheck
```

## Architecture

The target system. The parts drawn dashed are not built yet.

```mermaid
flowchart LR
  subgraph ingest["Ingest lane (background)"]
    direction LR
    UP["Upload<br/>PDF, text, images"] --> ST[("Storage<br/>local / S3 / R2")]
    UP --> Q["BullMQ on Redis<br/>retries, backoff, dead letters"]
    Q --> W["Worker<br/>parse, chunk, embed"]
    ST --> W
  end
  subgraph answer["Answer lane (streamed)"]
    direction LR
    CH["Chat UI<br/>stop, retry, regenerate"] -->|SSE| CA["API /conversations<br/>auth, rewrite follow-ups"]
    CA --> RT["Retrieve<br/>vector + keyword, filtered"]
    SQ["Search box"] --> RT
    RT --> RR["Fuse and rerank<br/>S1 to S8"]
    RR --> LLM["LLM<br/>provider interface"]
    LLM --> CI["Cite<br/>server maps S-numbers to pages"]
    RR --> CI
  end
  WEB["Web<br/>Next.js + Meridian"] --> API["API<br/>Express + Zod"]
  API --> AC["requireAccess<br/>proof of membership"]
  AC --> DB[("MongoDB<br/>users, workspaces, documents, chunks")]
  API --> UP
  W --> DB
  RT --> VS[("Atlas Vector Search + Search<br/>indexes over chunks")]
  DB --- VS
  EV["Evaluation<br/>200+ labelled questions, CI gate (week 5)"] -.-> RT
  CA --> DB
```

Solid lines exist today. Everything that touches a workspace's data goes through `requireAccess`
([ADR 0001](docs/adr/0001-workspace-access-is-proved-by-a-type.md)). Chunks and their vectors are already stored
with their `workspaceId`, and the search indexes filter on it inside the query.

### From upload to indexed (built)

1. The API checks the caller's editor role, reads the first bytes to decide what the file is, stores it, records the
   document as `queued` and queues a job. It answers `202`.
2. The worker re-checks that the uploader still has access, then parses the file page by page (PDF text, a text
   file, or OCR for an image).
3. Each page is split at paragraph, sentence and word boundaries into chunks that never cross a page
   ([ADR 0005](docs/adr/0005-chunking-by-structure-with-overlap.md)).
4. The chunks are embedded in batches and stored with their page, workspace and vector, replacing any earlier
   attempt. The document becomes `indexed`, or `failed` with a reason the user can act on.
5. The web app polls while anything is in progress, so the status moves on screen without a refresh.

### How a question becomes a cited answer (built)

1. The UI shows your message instantly and opens a Server-Sent Events stream.
2. The API rewrites a follow-up ("what about 2025?") into a standalone question.
3. Hybrid retrieval runs vector and keyword search with a `workspaceId` filter that server code adds, never the model.
4. Results are merged with reciprocal rank fusion, reranked and numbered S1 to S8.
5. The model answers from those sources only and cites them by number while tokens stream to the browser.
6. The server maps each number to its stored page and passage, drops unknown ones, and logs tokens, latency and cost.

## What is built

| Week | Phase      | State                                                                                                                                                                                                                                 |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Foundation | **Done.** Accounts, guest login, sessions, workspaces, three roles, member management, threat model, three ADRs, CI, design-system UI.                                                                                                |
| 2    | Ingest     | Not started. Storage, BullMQ queue, parsing, chunking, embeddings, live status.                                                                                                                                                       |
| 3    | Retrieval  | Not started. Hybrid search, tenant filter, citations.                                                                                                                                                                                 |
| 4    | Chat       | **Done.** Streaming over SSE, Stop that saves the partial answer, Regenerate and Retry, follow-up rewriting, saved and searchable history, sharing with the workspace, time to first word shown, safe Markdown with error boundaries. |
| 5    | Measure    | Not started. Eval harness, red-team cases, cost tracking, tool approval.                                                                                                                                                              |
| 6    | Show       | Not started. Hardening, deploy, benchmark report, demo video.                                                                                                                                                                         |

### Numbers

Measured on the development laptop (macOS, Node 22, MongoDB Atlas Local 8.3, Redis 8). Reproduce with
`docker compose up -d` and `npm run test:coverage`. No performance numbers are published yet: ingest and search
latency are measured in the week 6 benchmark against a real embedding model, because the hash embedder would
flatter them.

| What                 | Result                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tests                | 355 passing against Atlas Local (shared 25, core 209, API 67, web 54); 4 more run in CI against an S3 mock |
| Without Atlas Search | 319 pass and the 40 search tests are skipped, never faked, on a plain `mongod`                             |
| Coverage, core       | 93% statements, 85% branches                                                                               |
| Coverage, API        | 96% statements, 88% branches                                                                               |
| Cross-workspace hits | 0, in the adversarial suite (each search stage alone, 9 attack queries, 40 random property runs)           |
| Streaming            | 20 chunks over 1.1 s through the Next proxy (extractive model at 60 ms a word), uncompressed               |
| Strict TypeScript    | `noUncheckedIndexedAccess`, no `any` (lint-enforced)                                                       |

The streaming row measures the transport, not a model: it proves words arrive as they are written and are not held
back. Time to first word, tokens and total time are recorded on every saved answer, and published against a real
model with the benchmark in week 5 and 6.

Search tests need `SEARCH_TEST_URL` (for example `mongodb://127.0.0.1:27018` with `docker compose up -d`). The
full suite ran 5 times in a row without a failure after the index wait was fixed. The two flakes found on the way, and
what caused them, are written up in [ADR 0007](docs/adr/0007-atlas-search-on-atlas-local.md) and
[ADR 0008](docs/adr/0008-hybrid-retrieval-and-the-tenant-filter.md).

Known gaps in what the tests cover: the real Tesseract OCR path and the S3 driver's signed links are exercised
by hand and in CI (S3), not in the default local test run. `parse.ts` is the least covered module (76%) for that
reason. The CI workflow itself has not been run: I cannot start GitHub Actions from here.

## Repository

```
atlas-ai/
├─ apps/
│  ├─ web/          Next.js frontend, built from @yashwanthvarma74/react
│  ├─ api/          Express API
│  └─ worker/       BullMQ worker: parse, chunk, embed
├─ packages/
│  ├─ shared/       types and Zod schemas used by both sides
│  └─ core/         data model, access control, accounts, workspaces,
│                    documents, queue, parsing, chunking, embeddings, storage
├─ docs/
│  ├─ adr/          decision records
│  └─ THREAT-MODEL.md
└─ .github/         CI and Dependabot
```

## Key decisions

- [0001. Workspace access is proved by a type, not remembered by each route](docs/adr/0001-workspace-access-is-proved-by-a-type.md)
- [0002. Build the UI with the design system](docs/adr/0002-build-the-ui-with-the-design-system.md)
- [0003. Accounts, sessions and guests](docs/adr/0003-accounts-and-sessions.md)
- [0004. Ingest is a queue of idempotent jobs](docs/adr/0004-ingest-is-a-queue-of-idempotent-jobs.md)
- [0005. Chunking by structure, with a little overlap](docs/adr/0005-chunking-by-structure-with-overlap.md)
- [0006. Uploads are untrusted bytes](docs/adr/0006-uploads-are-untrusted-bytes.md)
- [0007. Atlas Vector Search and Atlas Search, developed on Atlas Local](docs/adr/0007-atlas-search-on-atlas-local.md)
- [0008. Hybrid retrieval, and a tenant filter that is tested at every layer](docs/adr/0008-hybrid-retrieval-and-the-tenant-filter.md)
- [0009. Citations are owned by the server](docs/adr/0009-citations-are-owned-by-the-server.md)
- [0010. Answers stream over Server-Sent Events, and Stop means "save what you have"](docs/adr/0010-answers-stream-over-sse-and-stop-means-save.md)
- [0011. Conversations are private until their author shares them](docs/adr/0011-conversations-are-private-until-shared.md)
- [0012. The model is behind an interface, and everything it sees or says is untrusted](docs/adr/0012-the-model-is-behind-an-interface-and-everything-it-sees-or-says-is-untrusted.md)

The threat model is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Known limits of week 4

- **The hosted model providers (OpenAI, Anthropic, Ollama) are untested against their live services.** Their request
  and stream formats are tested against fixtures in each provider's documented shape. Gemini is not implemented.
- **Retrieval quality and answer quality are not measured yet.** There is no labelled question set until week 5, and
  the default embedder and model have no sense of meaning. Nothing here claims a score.
- **No relevance cutoff.** Search always returns the nearest passages, so an unanswerable question still gets
  results ([ADR 0008](docs/adr/0008-hybrid-retrieval-and-the-tenant-filter.md)). The cutoff is calibrated in week 5.
- **A citation is checked to exist, not to support its sentence.** That is the citation-accuracy metric in week 5.
- **No agents or tool calls yet** (week 5).
- **Switching embedding model needs a re-index.** The vector index is built for one dimension count.
- **The CI workflow has not been run**, and the context view shows a page's stored passages, not the rendered PDF page.
