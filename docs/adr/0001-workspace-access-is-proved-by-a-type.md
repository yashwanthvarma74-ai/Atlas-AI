# 0001. Workspace access is proved by a type, not remembered by each route

Status: accepted

## Context

Atlas AI holds private documents for many workspaces in the same collections. The worst bug the product can have is
one workspace reading another's data, and the spec says the defence must not depend on the model or on a prompt:
server code adds the `workspaceId` filter to every query.

"Every query" is a discipline, and disciplines fail quietly. A route written at midnight that forgets the check
still compiles, still passes its happy-path test, and leaks.

## Decision

`requireAccess(core, userId, workspaceId, minimumRole)` looks up the user's membership and returns a
`WorkspaceAccess`. That type is branded with a `unique symbol` that is not exported, so no other module can
construct one without a cast. Every function that reads or writes a workspace's data takes a `WorkspaceAccess`
instead of a workspace id. Later phases follow the same rule: `listDocuments(core, access)`,
`retrieve(core, access, query)`, and so on. The `workspaceId` in each query comes from `access.workspaceId`.

The check answers three ways:

- Not a member: **404**, the same body as for a workspace that does not exist, so ids cannot be probed.
- A member whose role is too low: **403**, because they already know the workspace exists.
- Allowed: the proof.

Roles are `viewer < editor < owner`. There is exactly one owner per workspace, set at creation. Nobody is promoted
to it and it cannot be removed, so a workspace never ends up with nobody who can manage it.

## Why

- **A missing check becomes a type error.** The review question changes from "did every route remember?" to "does
  this function take a `WorkspaceAccess`?", which a compiler answers.
- **Revocation is immediate.** Membership is read from the database on every request. Nothing about a role is
  stored in the session token, so removing someone takes effect on their next request.
- **The role lives next to the proof.** Handlers cannot ask "is this user an editor?" about the wrong workspace
  because the answer is inside the object that names the workspace.

## Evidence

- `workspaces.test.ts` runs a model-based property test (fast-check): random memberships across several
  workspaces, then asserts that access is granted to exactly the members, with exactly their roles, and "not
  found" to everyone else.
- Removing the role comparison in `requireAccess`, or the `role: { $ne: 'owner' }` guard in `removeMember`, makes
  named tests fail (checked by hand while writing this).
- `apps/api/src/workspaces.test.ts` checks the HTTP surface: an outsider's response is byte-identical to the
  response for an id that does not exist.

## Consequences

- A function that works on workspace data must take a `WorkspaceAccess`, which makes background workers (week 2)
  decide where their proof comes from. A job carries `workspaceId` and `userId`, and the worker calls
  `requireAccess` again when it starts, so a user removed while a job waited cannot have it run on their behalf.
- The brand is a convention that a cast can defeat. A lint rule banning `as WorkspaceAccess` outside `access.ts`
  is the next step if the code base grows.
- One extra indexed read per request (`memberships` on `workspaceId, userId`).

## Alternatives

- **A middleware that attaches the workspace to the request.** Fine for HTTP, but workers and scripts have no
  request, so they would need a second mechanism.
- **A repository class scoped to one workspace.** Close to this design. A plain function taking a proof is smaller
  and easier to test, and the codebase is function-based throughout.
- **Per-workspace collections or databases.** Strong isolation, but index and operational cost grow with the
  number of tenants, and Atlas Vector Search indexes are per collection.
