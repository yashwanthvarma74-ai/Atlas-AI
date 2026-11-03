# 0009. Citations are owned by the server

Status: accepted

## Context

A cited answer is only worth anything if the citation is true. A model asked to cite will cheerfully write a page
number, a file name or a source that was never shown to it.

## Decision

The model is shown numbered text and nothing else. `formatSources` produces `[S1]` followed by the passage, with no
file name, page, document id or chunk id. Everything that says where a passage came from stays on the server, in the
`Source` list built by retrieval.

When an answer comes back, `extractCitations` reads the `[S3]` and `[S3, S5]` markers and looks each number up in
that list:

- a number the server issued becomes a citation carrying the document, page, chunk and the start of the passage;
- a number it did not issue is **removed from the text**, and from a group it is part of;
- each source is listed once, in the order it first appears.

The numbers are per answer: S1 is whatever ranked first for this question. The browser never sees a model-supplied
address, only ids the server resolved.

## Why

- The model can point at a number, but it cannot invent a destination: there is nothing for it to invent.
- Unknown numbers are dropped, not flagged. A reader sees an answer with fewer citations, never one that points at
  a document the model was not given.

## Evidence

- `citations.test.ts`: a property test (300 runs) feeds random mixtures of valid markers, invalid markers, groups
  and arbitrary text, and asserts that no citation and no marker in the output is outside the issued numbers.
- Unit tests cover the group syntax, ordering, de-duplication, text that merely looks like a marker (`[1]`,
  `[Smith 2020]`, `[SX2]`), and an answer with no sources at all, where every number is refused.
- The prompt formatter is tested to contain no file name, page or id.

## What this does not do

- It does not check that the passage **supports** the claim next to the marker. A model can cite a real source for a
  sentence the source does not say. Measuring that is the "citation accuracy" metric in week 5.
- It is built and tested in week 3, but nothing calls it on a model's output yet; chat arrives in week 4. What the
  UI does today is search: results are numbered S1, S2, ..., and "Show in context" opens the cited page's
  passages with the cited one marked (`GET .../documents/:id/passages?page=N`).
- The context view shows a page's stored passages, not the rendered PDF page. Neighbouring passages overlap by
  design, so a few words repeat. Rendering the original page is a possible extra.

## Alternatives

- **Let the model write the file name and page.** Looks natural, and is what makes invented citations possible.
- **Structured output (a JSON list of citations).** Still lets the model emit an id that was never issued, and
  would need the same validation. The inline marker is simpler to stream.
