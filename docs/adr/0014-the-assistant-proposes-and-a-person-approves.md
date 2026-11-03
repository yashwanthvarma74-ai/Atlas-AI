# 0014. The assistant proposes, and a person approves

Status: accepted

## Context

Text inside a document can talk a model into asking for things. If asking is the same as doing, any uploaded file
can act with the reader's authority. The spec wants agents that propose, people that approve, and every call audited.

## Decision

- **A tool is a request, never an action.** The model writes `<tool_call>{...}</tool_call>` in its answer. The server
  reads it only from the model's own finished output, removes it from the words the person reads, validates it, and
  saves it as `proposed`. Nothing runs.
- **One tool exists: `save_note`**, which writes a text note into the workspace (and so indexes it). It needs the editor
  role. The registry also supports tools that need no approval; none ships.
- **Arguments are checked twice.** Against a strict schema when proposed (an argument the tool does not define is
  refused, not ignored), and again when approved, because what sits in the database between the two is not trusted.
- **Approval is exact.** The person approving must be the conversation's author (a colleague reading a shared
  conversation sees the request and cannot answer it; a private one is invisible to them), and must hold a role the tool
  allows _at that moment_, not when it was proposed. Approval first claims the request with a conditional update, so
  two approvals at once run the tool once. Requests lapse after an hour.
- **Everything is recorded**: refused requests, rejected ones and failures included, with who decided and when. The
  owner sees the whole workspace's trail; others see their own.
- **Only a finished answer can ask.** A stopped or failed answer's half-written request is hidden and ignored.
- **Passages cannot forge a request.** A passage's own `<tool_call>` tags are neutralised before the model sees it, so
  a model that merely quotes a document does not repeat a valid request.
- **The card shows the arguments as written**, as text, because the model chose them and the person is the check.

## Evidence

`tools.test.ts` (22 tests: validation, exactly-once under concurrent approval, role and authorship at approval time,
tampered arguments, expiry, a failing tool that leaks nothing) and the red-team suite (see [RED-TEAM.md](../RED-TEAM.md)),
with mutations that remove each defence making a named test fail.

## Limits

A person can approve something harmful that looks harmless. The card shows the real text and the scope is one tool
that writes one note, which keeps the damage of a wrong approval small. More tools need their own review.

## Alternatives

- **Native function calling per provider.** Shapes differ by provider; a tagged block works for all and is read by one
  parser.
- **Let the model act and ask forgiveness.** That is the failure this decision exists to prevent.
