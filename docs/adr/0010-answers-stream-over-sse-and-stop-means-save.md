# 0010. Answers stream over Server-Sent Events, and Stop means "save what you have"

Status: accepted

## Context

An answer takes seconds to write. Showing it word by word makes it feel instant and lets the person stop a wrong
one early. The server also has to cope with the browser going away mid-answer, a model that stalls, and two
answers being asked for at once.

## Decision

**Transport.** `POST .../conversations/:id/messages` answers with `text/event-stream`. The events are `start` (the
saved message ids), `sources` (what the answer may cite), `token` (a piece of text) and `done` (the finished,
saved message). `POST .../regenerate` writes the last answer again, which is what Retry on a failed answer does
too. SSE rather than WebSockets because words only flow one way, it is plain HTTP, and it is easy to proxy and trace.
Document status ([0004](0004-ingest-is-a-queue-of-idempotent-jobs.md)) is polled instead, because a document
changes a few times a minute while an answer changes several times a second. The frame reader and writer are
written by hand in `@atlas/shared` and used on both sides of the wire, so what the server writes and what the
browser and the model-provider clients read are tested against each other (including a property test that
cuts the bytes at random places).

**Errors before and after the stream starts.** Response headers are sent when the first event is ready. Everything
that can refuse the request (not signed in, not your conversation, an answer already in progress, a bad body) is
decided before that and comes back as an ordinary status code. After it, every outcome is an event: `done`
carries a message whose status is `complete`, `stopped` or `failed`, with a reason in plain words.

**One answer at a time per conversation**, enforced by a unique partial index on `messages` where `status` is
`streaming`. A second request cannot get past the insert, so there is no check-then-act window. An answer whose
writer died stays `streaming`, so one older than five minutes is treated as failed (on the next request, and by a
sweep in the worker).

**Stop is the connection closing.** The browser's Stop button aborts its `fetch`. The server sees the response close,
aborts the call to the model provider through an `AbortSignal`, and still finishes: it saves the words that had
arrived as a `stopped` message, with the citations in them checked. Closing the tab does the same thing, so
nothing a person saw is lost.

**Limits.** The model has 30 seconds to start and 120 in all; either failing marks the answer `failed` with its
own message and keeps what was written. Output is capped (`CHAT_MAX_OUTPUT_TOKENS`), and only the last six
messages go to the model. Each answer is rate limited per address (20 a minute). When retrieval finds nothing, the
model is not called at all.

**The model is raced against the abort signal.** A provider's network call rejects when aborted, but an answer
must not depend on every provider being well behaved: a stalled one that ignored its signal would hold the
conversation's one answer slot for ever. Iteration ends the moment the signal fires.

## What building it caught

- **Message order.** The question was given a timestamp taken after the answer placeholder's, so it could sort
  after its own answer. Stop, history and regenerate all depend on order. The question's time is now derived from the
  placeholder's (one millisecond earlier), and a test asks twelve questions in a row and checks the order.
- **History with holes.** A question whose answer failed was still sent to the model, producing two user turns in a
  row, which some providers refuse. History is now completed question and answer pairs only.
- **Citation chips remounting.** The Markdown link renderer was defined inside the component, so every render made
  a new component type and React threw away and redrew every chip, dropping keyboard focus from a chip whenever the
  page refreshed. The renderers are defined once, and what they need travels in context. A test checks that the
  same element, with focus, survives a re-render.
- **Buffering.** Compression can hold streamed words back until a buffer fills. `Cache-Control: no-transform`
  prevents it, and the live check through Next's proxy showed 20 chunks over 1.1 seconds, not one lump.

## Consequences

- While an answer streams, a citation is drawn as a plain label for numbers the search offered. It becomes a
  button once the answer is saved and checked.
- Reconnecting to an answer in progress is not supported. If the connection drops, the browser reloads what the
  server saved when it finished.
- A stage timeout cannot interrupt CPU work inside the server, only waiting. Streaming a model's words is waiting.

## Alternatives

- **WebSockets.** Two-way, which this does not need, and harder to put behind ordinary proxies and traces.
- **Polling the saved message.** Simple, and the words arrive in lumps.
- **A cancel endpoint instead of closing the connection.** Needs an id to be known before anything has started, and
  does not cover the tab being closed.
