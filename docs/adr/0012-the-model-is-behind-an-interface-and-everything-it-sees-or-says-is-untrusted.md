# 0012. The model is behind an interface, and everything it sees or says is untrusted

Status: accepted

## Context

The spec lists OpenAI, Anthropic, Gemini and Ollama behind one provider interface, and wants a threat model that
treats document text as data. A reviewer should also be able to run the whole app with no key and no service.

## Decision

**One interface, `LlmProvider.stream(request)`,** returning text pieces and, at the end, token counts. Implemented
for OpenAI, Anthropic and Ollama by reading each provider's streaming format with the shared SSE and
line-delimited-JSON readers. Gemini is not implemented yet: adding it is one more file with the same shape.
Errors say whether trying again can help (`LlmError.retryable`: a 429 or 5xx, yes; a bad key, no) and never include
the provider's response body or the key.

**An offline provider, `extractive`,** is the default. It reads the numbered sources out of its prompt as a model
would and answers by quoting the first sentence of the best two, each followed by its number. It cannot reason or
paraphrase and is not a substitute for a model. It exists so retrieval, streaming, stopping, citations, history and
sharing run and are tested with no service, and it also stands in for the short question-rewriting call.

**What the model sees is untrusted data.**

- Passages go inside a `<sources>` block, and the system prompt says they are data and that instructions inside
  them are to be ignored. A passage that contains the closing tag has it neutered, so it cannot end the block and
  write its own instructions after it.
- The model is shown a number and the text, never a file name, page or id ([0009](0009-citations-are-owned-by-the-server.md)).
- Citation markers in earlier answers are removed before they are shown again, because their numbers belonged to
  other sources.
- A question that would be cited in a history is the person's own words, left exactly as written.

**What the model says is untrusted too.**

- Citations are checked against what the question was given; unknown numbers are removed from the saved text.
- The browser renders the answer as Markdown with images removed, links shown as plain text, raw HTML shown as text,
  and `javascript:` URLs dead. A citation-shaped link written by hand is not a citation: chips are only drawn for
  numbers the search offered.
- The model has no tools yet. When agents arrive in week 5, tool calls are checked and approved outside the model.

**Keys** live only in the server's environment. They are never sent to the browser, never put in a prompt, and not
included in error messages.

## What this does not prove

- **None of the three hosted providers has been run against its live service.** No key was available. Their
  request shapes and stream parsers are tested against recorded-shape fixtures taken from each provider's
  documented format, plus error and abort cases. Treat them as untested against reality until they have been run
  once with a real key. The extractive provider is the only one exercised end to end.
- **Prompt injection is mitigated, not solved.** Delimiting and instructions reduce it. The defence that holds is
  that the model has nothing to abuse: no tools, no way to fetch a URL, no way to load an image, and citations that
  cannot point outside what it was shown. The red-team cases in week 5 measure how well the instructions do.
- **A citation can be real and not support the sentence it sits next to.** That is the citation-accuracy metric.

## Evidence

- `prompt.test.ts`: the sources block cannot be closed from inside, no file name or id reaches the model, old
  citation numbers are stripped, user text is untouched.
- `llm.test.ts`: request bodies and headers for each provider, streamed text and token counts, retryable and
  permanent errors, no key in any message, abort passed through as an abort.
- `Answer.test.tsx`: images, links, HTML and `javascript:` URLs in model output.

## Alternatives

- **A framework (LangChain, an SDK per provider).** Heavier, and it hides the streaming and abort behaviour that
  this project is meant to show.
- **Make the first run need a key.** Every reviewer would have to bring one.
