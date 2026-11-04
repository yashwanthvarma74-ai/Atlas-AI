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

Embedder: `bge-small-en-v1.5` in process, as deployed, so every search includes embedding the question on the CPU.
Answers: the offline extractive answerer, so chat measures the system around the model and not a model.

| endpoint | in flight | p50 ms | p95 ms | p99 ms |
| -------- | --------- | ------ | ------ | ------ |
| search   | 1         | 5.7    | 9.0    | 11.4   |
| search   | 10        | 29.2   | 36.5   | 41.5   |
| search   | 50        | 131.7  | 174.0  | 233.8  |
| chat     | 1         | 8.9    | 11.9   | 13.6   |
| chat     | 10        | 23.4   | 42.3   | 48.7   |
| chat     | 50        | 94.5   | 166.8  | 176.8  |

Across the whole run: 14,251 iterations (about 184 a second), 19,881 requests, **0.00% failed**. The run is held to
thresholds (under 1% failed requests, search p95 under 500 ms, chat p95 under 2 s) and exits non-zero if one is missed.

Reading it: embedding the question is now most of a search, and latency grows with the number in flight as one Node
process saturates. These numbers are for an Apple M4 Pro. On the free host (a tenth of one CPU core) a single search
takes about 1.4 s, and a real model adds its own time to the first word (about 4 to 18 s on Gemini's free tier in the
answers seen while testing; not yet measured as a distribution).

## What was not measured

- A real answer model as a distribution: first-word time p95, citation consistency and cost per answer with Gemini.
  The benchmark against the live site has not completed on the free host.
- Recall on real documents (the benchmark is generated).
- Ingest throughput for large files, or many users uploading at once.
- A deployment: network latency, a managed database, cold starts.
- Behaviour at ten or a hundred times this load. What breaks first is written down in the
  [case study](case-study.md), as an argument and not a measurement.
