# Resume bullet

Every number below was measured, and each says how. Do not change a number without re-running the benchmark that
produced it, because an interviewer will ask how you got it.

> Built a multi-tenant RAG copilot (Next.js, Node, Atlas Vector Search, BullMQ) with streamed, cited answers; raised
> Recall@10 from 71.7% to 89.2% on a 276-question benchmark and held cross-workspace retrievals at 0 across an
> adversarial isolation suite; gated changes on the evaluation in CI.

What each claim rests on:

- **71.7% to 89.2%:** `npm run eval` before and after the chunk size, overlap and reranker sweep, on a benchmark
  generated from templates (`docs/EVALUATION.md`). Offline embedder. It will differ with a real model.
- **0 cross-workspace retrievals:** the adversarial suite (each search stage attacked alone, plus a property test), and
  the evaluation's own count, which searches a second workspace holding an identical copy of the corpus.
- **Gated in CI:** the workflow runs the evaluation, but it has not been run on GitHub from here.

Do not claim: a deployed product, a live demo, results with a hosted model, or the 0.90 recall target. It was not met.
