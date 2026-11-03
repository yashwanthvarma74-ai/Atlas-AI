# Benchmarks

Every number says how it was measured. Hardware: Apple M4 Pro, 14 cores, 24 GB; Docker was given 14 CPUs and 7.7 GB.
The load generator ran on the same machine as the containers, so it competes with them for CPU, and the numbers
are for this laptop, not for a deployment.

**What these measure.** The embedder is the offline `hash` one and the answer model is the offline `extractive` one,
so there is no network call to a model provider. They measure the system's own work (HTTP, authentication, search,
queueing, streaming, saving). A real model adds its own latency to the first word and the whole answer, and a
real embedder adds one embedding call to each search.

## Retrieval quality (benchmark of 276 questions)

Run with `npm run eval` (see [EVALUATION.md](EVALUATION.md)).

| Metric                                       | Result                                                      | Target            |
| -------------------------------------------- | ----------------------------------------------------------- | ----------------- |
| Recall@10                                    | 88.7% to 89.2% between runs                                 | 0.90, **not met** |
| Recall@10, questions in the document's words | 92%                                                         |                   |
| Recall@10, paraphrased questions             | 86%                                                         |                   |
| MRR                                          | 0.63                                                        |                   |
| Cross-workspace retrievals                   | 0                                                           | 0, met            |
| Citation consistency                         | 100% (the offline model only quotes, so this proves little) | 95%+              |

Before the sweep chose the chunk settings, recall@10 was 71.7% and MRR 0.37.

## Load (search and chat through the web container)

`BASE_URL=http://localhost:3002 npm run load -w @atlas/eval`, ten seconds at each level, a corpus of 30 documents
(about 325 passages). The API's rate limits were raised for the test (`RATE_LIMIT_SCALE=1000`), because they would
otherwise be what is measured.

| endpoint | in flight | req/s | p50 ms | p95 ms | p99 ms | first word p95 ms | errors |
| -------- | --------- | ----- | ------ | ------ | ------ | ----------------- | ------ |
| search   | 1         | 194.8 | 5      | 8      | 11     | -                 | 0.00%  |
| search   | 10        | 953.8 | 10     | 14     | 17     | -                 | 0.00%  |
| search   | 50        | 976.2 | 50     | 63     | 79     | -                 | 0.00%  |
| chat     | 1         | 116.5 | 8      | 11     | 12     | 8                 | 0.00%  |
| chat     | 10        | 472.6 | 21     | 26     | 33     | 22                | 0.00%  |
| chat     | 50        | 523.4 | 94     | 114    | 123    | 96                | 0.00%  |

Reading it: throughput stops growing between 10 and 50 requests in flight, while latency grows in proportion. That
is the machine saturating, not the service failing: no request errored. One chat request is a search, a rewrite
when it is a follow-up, a model call and several writes, and 11,127 answers were saved during the test with every
one `complete`.

## What was not measured

- Anything with a real model or embedder: first-word time, cost per answer (the offline provider costs $0), and
  recall on real documents.
- Ingest throughput for large files, or many users uploading at once.
- A deployment: network latency, a managed database, cold starts.
- Behaviour at ten or a hundred times this load. What breaks first is written down in the
  [case study](case-study.md), as an argument and not a measurement.
