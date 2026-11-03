# Threat model

Short on purpose. This lists what Atlas AI defends against, how, and which test would fail if the defence went
away. Rows for later phases are marked with the week they land; nothing here claims a defence that does not exist
yet.

## What an attacker wants

1. **Read another workspace's documents, chunks or conversations.**
2. **Make the model do something the user did not ask for**, by hiding instructions in a document.
3. **Run up the bill** (tokens, embeddings, storage) or take the service down.
4. **Get at keys and secrets.**

## Defences

Status: **built** means the code and its test exist today. **week N** means planned, not built.

| Threat                                            | Defence                                                                                                                                                                                            | Status                  | Test                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Cross-workspace leak through any route            | Every workspace function takes a `WorkspaceAccess`, which only `requireAccess` can make. Outsiders get the same 404 as a missing id ([ADR 0001](adr/0001-workspace-access-is-proved-by-a-type.md)) | built                   | `workspaces.test.ts` (core, property test) and `workspaces.test.ts` (API) |
| Cross-workspace leak through retrieval            | The `workspaceId` in every `$vectorSearch` and `$search` filter comes from `access.workspaceId`, never from the model or the request body                                                          | week 3                  | adversarial tenant-isolation suite in CI                                  |
| Role bypass (a viewer writing, a member managing) | Role is read from the database on every request; the owner role cannot be granted, changed or removed                                                                                              | built                   | `workspaces.test.ts` (core and API)                                       |
| Forged or stolen session                          | HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production; the server refuses to start in production with the development secret                                                   | built                   | `auth.test.ts`, `config.test.ts`                                          |
| Cross-site request forgery                        | `SameSite=Lax`, JSON bodies only, and a refused `Origin` on any write that names a foreign origin                                                                                                  | built                   | `auth.test.ts` ("cross-origin writes")                                    |
| Guessing passwords, or finding who has an account | scrypt with a per-hash salt; identical answer and similar timing for a wrong password and an unknown email; rate limits on sign-in and registration                                                | built (limits untested) | `users.test.ts`, `auth.test.ts`                                           |
| Injection through ids and bodies                  | Ids are parsed as 24-character hex or the request is "not found"; every body goes through a Zod schema and unknown fields are dropped                                                              | built                   | `workspaces.test.ts` ("malformed id"), `auth.test.ts` ("ignores fields")  |
| Prompt injection in an uploaded file              | Document text is data. Tools run only with schema-checked arguments, permission checks and user approval enforced outside the model                                                                | week 5                  | red-team cases in the eval set                                            |
| Malicious upload                                  | Type and size limits, parsing in isolated workers, nothing ever executed                                                                                                                           | week 2                  | upload fuzz cases                                                         |
| Runaway cost                                      | Rate limits, token caps, per-stage timeouts, cost recorded per answer                                                                                                                              | week 4 and 5            | cost-cap tests                                                            |
| Secret exposure                                   | Keys only in environment variables on the server, never in client code or model context. `.env` is ignored by git; `.env.example` holds only a development value                                   | partly built            | secret scan in CI (week 6)                                                |
| Vulnerable dependencies                           | Dependabot weekly; `npm audit --audit-level=high --omit=dev` fails CI                                                                                                                              | built                   | `ci.yml`                                                                  |

## What is not defended

- **Account enumeration by registration.** Registering with a taken email says so. Rate limited, not prevented
  (see [ADR 0003](adr/0003-accounts-and-sessions.md)).
- **Anyone who can sign in as a guest can create workspaces and data.** Guest creation is rate limited per
  address. Guests are not yet cleaned up.
- **A compromised server or database.** Documents are stored as the owner uploaded them, not encrypted per
  workspace.
- **Denial of service at the network layer.** That belongs to the host and the CDN.
