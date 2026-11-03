# 0005. Chunking by structure, with a little overlap

Status: accepted (the sizes are a starting point; the evaluation in week 5 decides them)

## Context

Retrieval returns chunks, and a citation points at one page. How a document is split decides what the model sees
and whether a cited page is the page the words are on.

## Decision

- **A chunk never spans two pages.** Each page is chunked on its own, so a citation names exactly one page.
- **Split at the largest natural boundary that fits:** a blank line, or the line before a Markdown heading; then a
  sentence; then a word; and inside a single word longer than a chunk, a character. Text is never cut mid-word
  unless one word is bigger than the whole chunk.
- **Target 256 tokens, overlap 32.** Tokens are estimated at four characters each (`CHUNK_TARGET_TOKENS`,
  `CHUNK_OVERLAP_TOKENS`). Each chunk after the first starts with the last units of the one before, up to the
  overlap, so a sentence that straddles a boundary is whole in at least one chunk. Overlap never exceeds half a
  chunk.
- **Pages with no text produce no chunks.** A document with no chunks at all fails with a reason ("Scanned PDFs are
  not supported yet") instead of being "indexed" and finding nothing.

## Why

- Page-bounded chunks make the spec's "click a citation, see the exact page" true by construction.
- Structure-aware splitting keeps a table of figures or a section heading with the text it belongs to better than a
  fixed window does.

## Evidence

- `chunk.test.ts` includes a property test (fast-check, 200 runs, random text, random target and overlap): no chunk
  is longer than the target, and every word of the input appears, in order, in the output.
- Unit tests cover paragraph before sentence, heading starts a unit, overlap repeats the previous tail, no overlap
  when asked, a single enormous word, and that pages never mix.

## What is not decided

256 and 32 are common defaults, not measured ones. The spec is explicit that "the numbers decide": week 5 builds
the labelled question set and compares sizes on Recall@10. This ADR is updated then, with the table.

## Consequences

- Tokens are an estimate. Real tokenisers differ by language and content; the embedding model's own limit needs a
  margin, which 256 gives for every model in use.
- An answer that needs two pages is two chunks, retrieved separately. That is a cost of exact citations.
- Scanned PDFs are not supported. Running OCR over PDF pages needs rendering them first; images uploaded directly
  are OCR'd.

## Alternatives

- **Fixed-size windows over the whole document.** Simpler, and cites ranges that cross pages.
- **Semantic chunking by embedding similarity.** Can beat structure on some text; costs an embedding pass per
  sentence. Worth trying if the evaluation shows boundaries are the problem.
