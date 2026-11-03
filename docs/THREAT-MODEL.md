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

| Threat                                                          | Defence                                                                                                                                                                                                                                                                                                             | Status                       | Test                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| Cross-workspace leak through any route                          | Every workspace function takes a `WorkspaceAccess`, which only `requireAccess` can make. Outsiders get the same 404 as a missing id ([ADR 0001](adr/0001-workspace-access-is-proved-by-a-type.md))                                                                                                                  | built                        | `workspaces.test.ts` (core, property test) and `workspaces.test.ts` (API) |
| Cross-workspace leak through retrieval                          | The `workspaceId` in every `$vectorSearch` and `$search` filter comes from `access.workspaceId`, never from the model or the request body                                                                                                                                                                           | week 3                       | adversarial tenant-isolation suite in CI                                  |
| Role bypass (a viewer writing, a member managing)               | Role is read from the database on every request; the owner role cannot be granted, changed or removed                                                                                                                                                                                                               | built                        | `workspaces.test.ts` (core and API)                                       |
| Work done for someone who lost access while their upload waited | The worker checks the uploader's editor role again when the job starts and fails the document if it is gone ([ADR 0004](adr/0004-ingest-is-a-queue-of-idempotent-jobs.md))                                                                                                                                          | built                        | `ingest.test.ts` ("uploader who has since been removed")                  |
| Reading a file by guessing its id or storage key                | Documents are fetched by id and workspace together; storage keys are made by the server; the local driver refuses any key outside its folder                                                                                                                                                                        | built                        | `documents.test.ts` (core and API), `storage.test.ts`                     |
| A stored file running in someone's browser                      | Served only as an attachment with `nosniff` and a `sandbox` CSP; signed URLs expire in five minutes and carry the same disposition                                                                                                                                                                                  | built                        | `documents.test.ts` (API, "downloads the original as an attachment")      |
| Forged or stolen session                                        | HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production; the server refuses to start in production with the development secret                                                                                                                                                                    | built                        | `auth.test.ts`, `config.test.ts`                                          |
| Cross-site request forgery                                      | `SameSite=Lax`, JSON bodies only, and a refused `Origin` on any write that names a foreign origin                                                                                                                                                                                                                   | built                        | `auth.test.ts` ("cross-origin writes")                                    |
| Guessing passwords, or finding who has an account               | scrypt with a per-hash salt; identical answer and similar timing for a wrong password and an unknown email; rate limits on sign-in and registration                                                                                                                                                                 | built (limits untested)      | `users.test.ts`, `auth.test.ts`                                           |
| Injection through ids and bodies                                | Ids are parsed as 24-character hex or the request is "not found"; every body goes through a Zod schema and unknown fields are dropped                                                                                                                                                                               | built                        | `workspaces.test.ts` ("malformed id"), `auth.test.ts` ("ignores fields")  |
| Prompt injection in an uploaded file                            | Document text is data. Tools run only with schema-checked arguments, permission checks and user approval enforced outside the model                                                                                                                                                                                 | week 5                       | red-team cases in the eval set                                            |
| Malicious upload                                                | The type is decided from the bytes (not the name or `Content-Type`); 20 MB and 500-page limits; parsed in the worker process, a separate process from the API; pdf.js 5 has no code-evaluation path; nothing is executed; downloads are sandboxed attachments ([ADR 0006](adr/0006-uploads-are-untrusted-bytes.md)) | built (parser not sandboxed) | `sniff.test.ts`, `documents.test.ts` (API), `parse.test.ts`               |
| Runaway cost                                                    | Rate limits, token caps, per-stage timeouts, cost recorded per answer                                                                                                                                                                                                                                               | week 4 and 5                 | cost-cap tests                                                            |
| Secret exposure                                                 | Keys only in environment variables on the server, never in client code or model context. `.env` is ignored by git; `.env.example` holds only a development value                                                                                                                                                    | partly built                 | secret scan in CI (week 6)                                                |
| Vulnerable dependencies                                         | Dependabot weekly; `npm audit --audit-level=high --omit=dev` fails CI                                                                                                                                                                                                                                               | built                        | `ci.yml`                                                                  |

## What is not defended

- **The worker is not sandboxed.** It is a separate process from the API, so a crashing parser cannot take the
  API down, but it holds the database credentials and could read what the worker can read if the parser were
  exploited. Running it in a container with no inbound network and a read-only filesystem is planned for the
  deployment week.
- **Image OCR runs in the worker process** (Tesseract, WebAssembly), with the same limit.
- **A stage timeout cannot interrupt synchronous CPU work** in the PDF parser; the size and page limits bound it.

- **Account enumeration by registration.** Registering with a taken email says so. Rate limited, not prevented
  (see [ADR 0003](adr/0003-accounts-and-sessions.md)).
- **Anyone who can sign in as a guest can create workspaces and data.** Guest creation is rate limited per
  address. Guests are not yet cleaned up.
- **A compromised server or database.** Documents are stored as the owner uploaded them, not encrypted per
  workspace.
- **Denial of service at the network layer.** That belongs to the host and the CDN.
