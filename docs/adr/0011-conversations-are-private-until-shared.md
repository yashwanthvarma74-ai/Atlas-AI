# 0011. Conversations are private until their author shares them

Status: accepted

## Context

A workspace is shared by its members, but what one member asks is theirs: a question about a layoff plan, or a
salary band, should not be readable by a colleague who can read the same documents. The spec also wants saved
history that can be searched, reopened and shared.

## Decision

- A conversation belongs to the person who started it. It is `private` by default.
- The author can switch it to `workspace`. Then **every member can read it**, viewers included, and nobody but the
  author can add to it, rename it, change its sharing or delete it.
- Making it private again hides it again immediately.
- A private conversation of someone else's answers **404**, identical to a conversation that does not exist, so
  nobody can tell that a colleague has been asking about something. A shared one that a reader may not change
  answers 403.
- The whole rule is two small functions, `canRead` and `canWrite`, applied in one place (`loadConversation`) that
  every read and write goes through.
- **Search over history** (`GET .../conversations?q=`) uses MongoDB text indexes on titles and messages, scoped to
  the workspace, and then keeps only the conversations the caller may read. A private conversation's words never
  match for anyone else.
- **No public links.** Sharing stops at the workspace. A link that anyone could open would hand out cited passages
  from documents that were uploaded under the workspace's access rules, which is a different and bigger decision.

## Why

The workspace is already the unit of access to documents ([0001](0001-workspace-access-is-proved-by-a-type.md)).
Conversations add a second, smaller circle inside it, and defaulting to the smaller one is the safe direction: sharing
is something a person does, not something that happens to them.

## Evidence

- `conversations.test.ts` covers the whole policy: private is invisible to other members, shared is readable and
  not writable, un-sharing hides again, a conversation in another workspace is invisible even to its own author,
  and a search for a word in someone's private conversation finds nothing for anyone else (then finds it once it is
  shared).
- The same rules are tested over HTTP in `chat.test.ts`, including that a hidden conversation's response body
  equals the response for a missing one.

## Consequences

- A shared conversation shows its cited passages to every member. They can already read those documents, so
  nothing new is exposed, but it is why sharing is a deliberate switch with a visible label.
- Deleting a shared conversation removes it for everyone it was shared with.
- A member who leaves the workspace keeps no access to anything: the workspace check happens first.
- Search is whole-word, as MongoDB text search is. "zeppelin" finds "Zeppelin"; "zepp" does not.

## Alternatives

- **Everything shared by default.** Simpler, and a privacy surprise.
- **Per-person sharing (share with Eddie).** More flexible, and needs a picker and a second list of who can see
  what. The workspace is the group the spec names.
