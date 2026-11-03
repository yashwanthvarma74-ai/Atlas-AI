# 0016. Traces from spans, and a parser in its own process

Status: accepted

## Context

The spec asks for traces from request to retrieval to first token, and for uploads to be parsed "in isolated
workers". Until now there was per-answer timing saved with each message and structured logs, and the PDF parser and
OCR engine ran inside the worker, which holds the database credentials.

## Decision

- **Spans carry ids, counts and timings, never text.** A question, a passage or an answer in a span would make the
  trace backend another place data can leak from. The answer is one span with child spans for the rewrite, the
  retrieval (embed, vector search, keyword search) and the model call, which records the first-word time, the token
  counts and the cost. Ingest has a span per document with children for parsing and embedding. Retrieval time and
  model time are separate spans, so a slow answer is blamed on the right one.
- **Tracing is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.** With no collector the code paths are no-ops.
- **The exporter is ours, about sixty lines over `fetch`.** OTLP with a JSON body is a few fields per span. The
  packaged exporter pulled in a second copy of the tracing API at an incompatible version, so spans silently went
  nowhere; ours has a test of the wire format and was checked against a real Tempo. Grafana's `otel-lgtm` image is
  the local collector (`--profile observability`), with the dashboard in `infra/grafana`.
- **Each upload is parsed in a forked child process** (`PARSE_ISOLATION=process`). The child gets an environment
  with only `PATH`, `HOME` and `TMPDIR`, a 384 MB heap limit, and is killed after the stage timeout. A crash, an
  out-of-memory kill or a hang costs the child and becomes a `failed` document with a reason, and the worker carries
  on. It is built as a second entry point of each app so the same compiled code runs in the child.

## Evidence

The traces were read back from Tempo, nested and with the attributes above. A 31-page PDF was parsed in a child
process and indexed. `parse-isolated.test.ts` runs real child processes that answer, reject, crash, hang and try to
read a parent secret.

## Consequences

Isolation is a process boundary, not a sandbox: the child can still read files the user running it can. Putting the
worker in a container with no inbound network and a read-only filesystem is the next layer, and the deploy guide says
so. A child per file costs about a tenth of a second of start-up, which is nothing next to parsing a PDF but would
matter for thousands of tiny files.

## Alternatives rejected

- `worker_threads`: a separate heap, but the same address space and the same environment.
- A sandboxing library or `isolated-vm`: it isolates JavaScript, and the threat here is a native parser.
- The packaged OTLP exporter: tried first, and abandoned for the reason above.
