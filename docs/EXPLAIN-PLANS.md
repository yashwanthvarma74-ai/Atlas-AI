# Query plans

How MongoDB runs every query the API makes on a filter or a sort. Reproduce: `docker compose up -d`, then
`npm run explain -w @atlas/eval`. It builds a throwaway database (40 workspaces, 50 documents, conversations and tool
calls in each, 4,000 chunks, 400 messages), runs `explain('executionStats')` on each query, and exits non-zero if a plan
scans a whole collection or sorts in memory.

Hardware and engine: an Apple M4 Pro laptop, MongoDB Atlas Local (the same server engine as an Atlas cluster).

What it found. The first run showed six queries sorting in memory, because their sorts end in `_id` (a tie-break, so
pages never repeat or skip a row) and their indexes did not. The indexes now end in `_id` too, and the table below is
the run after the fix.

| Query                                                            | Plan                                                                    | Keys examined | Docs examined | Returned |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------: | ------------: | -------: |
| Access check on every request: memberships by workspace and user | FETCH → IXSCAN (workspaceId_1_userId_1)                                 |             1 |             1 |        1 |
| "My workspaces": memberships by user, oldest first               | FETCH → IXSCAN (userId_1_createdAt_1)                                   |             1 |             1 |        1 |
| Member list: memberships of one workspace, oldest first          | FETCH → IXSCAN (workspaceId_1_createdAt_1)                              |             5 |             5 |        5 |
| Document library: one workspace, newest first                    | FETCH → IXSCAN (workspaceId_1_createdAt_-1__id_-1)                      |            50 |            50 |       50 |
| Requeue sweep: queued documents not touched lately               | LIMIT → FETCH → IXSCAN (status_1_updatedAt_1)                           |             0 |             0 |        0 |
| Passages of a page, in order                                     | FETCH → IXSCAN (documentId_1_ord_1)                                     |             8 |             8 |        8 |
| Delete or re-process a document: its chunks                      | FETCH → IXSCAN (documentId_1_ord_1)                                     |             8 |             8 |        8 |
| History: my conversations, newest first                          | FETCH → IXSCAN (workspaceId_1_userId_1_updatedAt_-1__id_-1)             |            25 |            25 |       25 |
| History: conversations shared with the workspace                 | FETCH → IXSCAN (workspaceId_1_visibility_1_updatedAt_-1__id_-1)         |            17 |            17 |       17 |
| A conversation, oldest message first                             | FETCH → IXSCAN (conversationId_1_createdAt_1__id_1)                     |            40 |            40 |       40 |
| Recent messages for the prompt, newest first                     | LIMIT → FETCH → IXSCAN (conversationId_1_createdAt_1__id_1)             |            16 |            16 |       16 |
| Tool calls in a conversation                                     | FETCH → IXSCAN (conversationId_1_createdAt_1__id_1)                     |             1 |             1 |        1 |
| Audit trail (owner): the workspace, newest first                 | LIMIT → FETCH → IXSCAN (workspaceId_1_createdAt_-1__id_-1)              |            50 |            50 |       50 |
| Audit trail (anyone else): their own, newest first               | LIMIT → FETCH → IXSCAN (workspaceId_1_proposedBy_1_createdAt_-1__id_-1) |            50 |            50 |       50 |
| Evaluation dashboard: runs, newest first                         | LIMIT → FETCH → IXSCAN (createdAt_-1)                                   |             0 |             0 |        0 |

Every query uses an index and none sorts in memory.

Not covered here: the two search queries. `$vectorSearch` and `$search` are not run by the query planner, and both carry
the workspace filter inside the stage itself (see [ADR 0008](adr/0008-hybrid-retrieval-and-the-tenant-filter.md)).
The text indexes on conversation titles and message text are used by `$text` queries, which also filter by workspace.
