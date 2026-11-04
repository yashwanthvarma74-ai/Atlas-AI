# Benchmarks

Every number says how it was measured. Hardware: Apple M4 Pro, 14 cores, 24 GB; Docker was given 14 CPUs and 7.7 GB.
The load generator ran on the same machine as the containers, so it competes with them for CPU, and the numbers
are for this laptop, not for a deployment.

**What these measure.** The embedder is the offline `hash` one and the answer model is the offline `extractive` one,
so there is no network call to a model provider. They measure the system's own work (HTTP, authentication, search,
queueing, streaming, saving). A real model adds its own latency to the first word and the whole answer, and a
real embedder adds one embedding call to each search.

## Retrieval quality (benchmark of 240 questions)

Run with `npm run eval` (see [EVALUATION.md](EVALUATION.md)).

| Metric                                       | Result                                                      | Target        |
| -------------------------------------------- | ----------------------------------------------------------- | ------------- |
| Recall@10                                    | **95.4%** on the CI runner, 96.7% on the M4 Pro             | 0.90, **met** |
| Recall@10, questions in the document's words | 95.0% / 95.8%                                               |               |
| Recall@10, paraphrased questions             | 95.8% / 97.5%                                               |               |
| Cross-workspace retrievals                   | 0                                                           | 0, met        |
| Citation consistency                         | 100% (the offline model only quotes, so this proves little) | 95%+          |

The embedder is the one the deployment runs, `bge-small-en-v1.5` in process. With the hash embedder (words, not
meaning) the same benchmark scored 89.2%, and before the chunk sweep 71.7%.

## Load (k6, against the API)

`infra/k6/atlas.js`, run with k6 in Docker against the built API (one Node process with the ingest worker inside it,
parsing in child processes) and Atlas Local, all on the same laptop. Ten seconds at each of 1, 10 and 50 virtual users,
one request in flight per user, a corpus of 30 documents (about 325 passages). The API's rate limits were raised
(`RATE_LIMIT_SCALE=100000`), because they would otherwise be what is measured.

```bash
docker run --rm -i -v "$PWD:/work" -w /work/infra/k6 -e BASE_URL=http://host.docker.internal:4002 grafana/k6 run atlas.js
```

| endpoint | in flight | p50 ms | p95 ms | p99 ms |
| -------- | --------- | ------ | ------ | ------ |
| search   | 1         | 2.8    | 3.8    | 5.2    |
| search   | 10        | 7.4    | 9.5    | 11.6   |
| search   | 50        | 35.7   | 44.8   | 50.2   |
| chat     | 1         | 6.9    | 10.5   | 12.4   |
| chat     | 10        | 11.8   | 18.5   | 20.8   |
| chat     | 50        | 42.7   | 71.5   | 79.6   |

Across the whole run: 41,837 iterations (about 521 a second), 53,379 requests, **0.00% failed**, and every one of
the 41,837 checks passed. The first word of an answer, as the server recorded it for each chat, was p50 23 ms, p95 41 ms,
p99 47 ms. The script holds the run to thresholds (under 1% failed requests, search p95 under 500 ms, chat p95 under
2 s), and exits non-zero if one is missed.

Reading it: latency grows with the number of requests in flight, as a single Node process saturating would show. A
chat is a search, a rewrite when it is a follow-up, a model call and several writes. Two things are not in these numbers:
a real model's time, and the network. Run once on a laptop, so treat the third digit as noise.

## What was not measured

- Anything with a real model or embedder: first-word time, cost per answer (the offline provider costs $0), and
  recall on real documents.
- Ingest throughput for large files, or many users uploading at once.
- A deployment: network latency, a managed database, cold starts.
- Behaviour at ten or a hundred times this load. What breaks first is written down in the
  [case study](case-study.md), as an argument and not a measurement.
