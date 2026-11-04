# 0017. Embeddings run in the process, not behind someone else's quota

Status: accepted

## Context

The hosted demo embedded passages with a free hosted model (Gemini). Uploads failed: a 37 KB PDF came back with "the
embedding service answered 429" after every retry, because the free allowance was spent. Pacing the requests helped a
large file only by making it slow, and could not help once the daily allowance was gone. As long as each upload needs
a third party's free quota, uploads fail for reasons the app cannot see or fix.

At the same time the offline `hash` embedder, which needs no service, matches shared words and not meaning, and it was
the reason recall@10 was 89.2%, short of the spec's 0.90.

## Decision

- **A small embedding model runs inside the API and worker**, on the CPU, through ONNX Runtime
  (`@huggingface/transformers`, `EMBEDDING_PROVIDER=local`). The model is `bge-small-en-v1.5`, quantised to 8 bits:
  384 dimensions, about 33 MB, about 1 ms a passage on a laptop. Questions carry BGE's search instruction; passages do
  not.
- **The model is in the container image** (`infra/fetch-models.mjs` at build time), with Tesseract's fast English model
  beside it, so a container downloads nothing when it starts or when someone uploads.
- **Changing embedder no longer needs hands in the database** when `VECTOR_INDEX_REBUILD=true`: the old vector index is
  dropped, vectors of the old model are deleted, and their documents go back in the queue, where the requeue sweep
  embeds them again. Without the setting the app still refuses to start on a size mismatch.
- **Hosted embedders stay available** (OpenAI, Voyage, Gemini, Ollama), for a deployment that pays for its quota.
- **`hash` stays the test default**, because it is instant and identical on every machine.

## Evidence

On the 240-question benchmark, with nothing else changed: recall@10 went from 89.2% to **96.7%** (same words 95.8%,
paraphrased 97.5%), cross-workspace hits stayed 0, and search p95 was 8 ms on the laptop. A container limited to the
free host's 512 MB and 0.1 CPU indexed documents with memory under its limit (numbers in
[BENCHMARKS.md](../BENCHMARKS.md)).

## Consequences

The API image is larger (about 1.7 GB with ONNX Runtime). The model takes memory in each process that embeds, about
170 MB; on the free host that is the one process that does everything. Embedding speed is bounded by the machine's CPU
instead of by a quota: slower on a 0.1 CPU host, but it does not fail.

## Alternatives rejected

- Pacing a hosted free tier: slow, and still fails once the daily allowance is spent.
- A paid embedding API: the deployment is meant to cost nothing.
- A larger local model (768 dimensions): about three times slower, on a machine that is already the bottleneck.
