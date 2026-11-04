# Resume bullet

Every number below was measured, and each says how. Do not change a number without re-running what produced it, because
an interviewer will ask how you got it.

> Built and deployed a multi-tenant RAG copilot (Next.js, Node, MongoDB Atlas Vector Search, BullMQ) with streamed,
> cited answers; raised Recall@10 from 71.7% to 95.4% on a 240-question benchmark and held cross-workspace retrievals
> at 0 across an adversarial isolation suite, with the evaluation gating every change in CI.

What each claim rests on:

- **Deployed:** <https://atlas-ai-seven-vert.vercel.app>, guest login, answers from Gemini.
- **71.7% to 95.4%:** `npm run eval`. 71.7% was the first chunk settings with a word-matching embedder; a sweep of
  chunk size, overlap and reranker took it to 89.2%; moving to an in-process semantic embedder (`bge-small-en-v1.5`)
  took it to 95.4% on the CI runner (96.7% on an M4 Pro). The benchmark is generated (`docs/EVALUATION.md`).
- **0 cross-workspace retrievals:** the adversarial suite (each search stage attacked alone, plus a property test), and
  the evaluation's own count, which searches a second workspace holding an identical copy of the corpus.
- **Gated in CI:** GitHub Actions runs the evaluation on every push and fails on a drop.

Do not claim: recall on real documents, a measured first-word time or citation accuracy for the hosted model, or speed
on the free host. None of those has been measured.
