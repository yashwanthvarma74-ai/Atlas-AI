# Architecture decision records

One short file per decision that someone could reasonably have made differently. Each states the context, the
decision, the evidence, the consequences and the alternatives that were rejected.

| #    | Decision                                                                                                                                                              | Status   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Workspace access is proved by a type, not remembered by each route](0001-workspace-access-is-proved-by-a-type.md)                                                    | accepted |
| 0002 | [Build the UI with the design system](0002-build-the-ui-with-the-design-system.md)                                                                                    | accepted |
| 0003 | [Accounts, sessions and guests](0003-accounts-and-sessions.md)                                                                                                        | accepted |
| 0004 | [Ingest is a queue of idempotent jobs](0004-ingest-is-a-queue-of-idempotent-jobs.md)                                                                                  | accepted |
| 0005 | [Chunking by structure, with a little overlap](0005-chunking-by-structure-with-overlap.md)                                                                            | accepted |
| 0006 | [Uploads are untrusted bytes](0006-uploads-are-untrusted-bytes.md)                                                                                                    | accepted |
| 0007 | [Atlas Vector Search and Atlas Search, developed on Atlas Local](0007-atlas-search-on-atlas-local.md)                                                                 | accepted |
| 0008 | [Hybrid retrieval, and a tenant filter that is tested at every layer](0008-hybrid-retrieval-and-the-tenant-filter.md)                                                 | accepted |
| 0009 | [Citations are owned by the server](0009-citations-are-owned-by-the-server.md)                                                                                        | accepted |
| 0010 | [Answers stream over Server-Sent Events, and Stop means "save what you have"](0010-answers-stream-over-sse-and-stop-means-save.md)                                    | accepted |
| 0011 | [Conversations are private until their author shares them](0011-conversations-are-private-until-shared.md)                                                            | accepted |
| 0012 | [The model is behind an interface, and everything it sees or says is untrusted](0012-the-model-is-behind-an-interface-and-everything-it-sees-or-says-is-untrusted.md) | accepted |
| 0013 | [Quality is a number, and a change that lowers it does not merge](0013-quality-is-a-number-and-a-gate.md)                                                             | accepted |
| 0014 | [The assistant proposes, and a person approves](0014-the-assistant-proposes-and-a-person-approves.md)                                                                 | accepted |
