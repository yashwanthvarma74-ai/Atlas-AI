# Architecture decision records

One short file per decision that someone could reasonably have made differently. Each states the context, the
decision, the evidence, the consequences and the alternatives that were rejected.

| #    | Decision                                                                                                                                                              | Status   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Workspace access is proved by a type, not remembered by each route](0001-workspace-access-is-proved-by-a-type.md)                                                    | accepted |
| 0004 | [Ingest is a queue of idempotent jobs](0004-ingest-is-a-queue-of-idempotent-jobs.md)                                                                                  | accepted |
| 0008 | [Hybrid retrieval, and a tenant filter that is tested at every layer](0008-hybrid-retrieval-and-the-tenant-filter.md)                                                 | accepted |
| 0009 | [Citations are owned by the server](0009-citations-are-owned-by-the-server.md)                                                                                        | accepted |
| 0012 | [The model is behind an interface, and everything it sees or says is untrusted](0012-the-model-is-behind-an-interface-and-everything-it-sees-or-says-is-untrusted.md) | accepted |
