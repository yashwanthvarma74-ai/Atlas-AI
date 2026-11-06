# Deploying

**Live:** <https://atlasai-beta.vercel.app>, on free tiers with no card: Vercel (web), Render (API and ingest
worker in one service), MongoDB Atlas M0 (database, Atlas Search and Vector Search), Upstash (Redis) and Supabase
Storage (files, over its S3 API). Nothing in the repository holds a secret; each service has its own.

## One machine, in containers

```bash
JWT_SECRET=$(openssl rand -base64 48) docker compose --profile app up --build
# open http://localhost:3002 and press "Continue as guest"
```

This builds three images (API, worker, web), starts MongoDB with Atlas Search and Redis beside them, and runs the
whole app. The end-to-end tests in `e2e/` run against exactly this stack, and so does the CI job of the same name. The
API and the worker share one volume for uploads, which is why this works on one machine.

Settings that matter:

- `JWT_SECRET` is required. The API refuses to start in production with the development one.
- `COOKIE_SECURE=false` is set in the compose file only because it serves plain HTTP. Behind HTTPS leave it unset, so
  the session cookie is `Secure`.
- `API_URL` is a **build** argument of the web image: Next compiles the proxy target into the build.
- `SITE_ORIGIN` must be the web app's public URL: writes naming any other origin are refused.
- `TRUST_PROXY_HOPS` must match the number of proxies in front of the API, or rate limits see the wrong address.
- `PARSE_ISOLATION=process` parses each upload in a child process with none of the worker's credentials. On in the
  containers and in `render.yaml`; off by default for development.
- `INGEST_CONCURRENCY` is how many documents one worker processes at once (default 2). `render.yaml` sets 1, because the
  worker shares a 0.1 CPU machine with the API and page requests slow down while it works.
- `OTEL_EXPORTER_OTLP_ENDPOINT`, when set, sends traces there. `--profile observability` runs Grafana with Tempo
  on port 3000 for it, with the dashboard in `infra/grafana`.

## The hosted setup

| Piece          | Service                                           | Notes                                                                                                                                                   |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | Vercel Hobby                                      | Root directory `apps/web`; `API_URL` set to the API's address at build time. Pull requests get a preview deploy.                                        |
| API and worker | Render, free web service                          | `render.yaml` is the blueprint. `INLINE_WORKER=true` runs the ingest worker inside the API, because a free plan has no background workers.              |
| Database       | MongoDB Atlas M0                                  | `MONGODB_URI` must end in a database name, because the app uses the one in the address. The free tier allows three search indexes and the app uses two. |
| Redis          | Upstash                                           | `REDIS_URL` is the `rediss://` address (TLS).                                                                                                           |
| Files          | Supabase Storage                                  | S3-compatible: `S3_ENDPOINT` is the project's `/storage/v1/s3` address, with its region, bucket and access key.                                         |
| Models         | In-process embedder; Gemini free tier for answers | `EMBEDDING_PROVIDER=local`, `EMBEDDING_DIMENSIONS=384` (the model is in the image); `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`.                         |

**Deploys.** `.github/workflows/deploy.yml` runs after CI passes on `main` and calls the Render deploy hook, kept in
the repository secret `RENDER_DEPLOY_HOOK_URL`; `render.yaml` turns off Render's own deploy-on-push so a red CI run
cannot reach production. Vercel deploys the web app from git on its own.

**Changing the embedder.** The vector index is built for one vector size, and the app refuses to start with another
(`EMBEDDING_DIMENSIONS` against the index). Switching means deleting the `chunk_vectors` index in Atlas, restarting,
and re-uploading documents, because the stored vectors are the old size. Re-run `npm run eval` too: the best chunk
size depends on the embedder.

**Reading pictures.** An image is read with OCR. A page of text is read as one; a picture that reads poorly that way (an
infographic, a screenshot) is read again as scattered text keeping only the words OCR is sure of. On the free Render
machine one image takes about 35 to 45 seconds, against about 3 seconds on a laptop.

**What to expect on free tiers.** The Render service sleeps after 15 minutes without traffic, so the first visit waits
for it to wake. The free Redis has a monthly command quota. Supabase pauses a project after a week without use. Atlas
M0 has no automatic backups. A free model key has request limits and a busy model can answer 429 or 503, so a refused embedding batch is retried up to five times with growing waits before the document fails; a very large file can still run out of allowance.

## Before pointing the public at it

- Keep `RATE_LIMIT_SCALE` at 1.
- Run the worker in a container with no inbound network and a read-only filesystem except for `/data` and the
  temporary directory. Parsing already happens in a child process without the worker's credentials, which is a process boundary and not a sandbox.
- **Nothing is kept on the demo.** `WIPE_ON_REFRESH=true` empties a visitor's own workspaces (documents, files,
  passages, conversations) whenever they load a page, and `DATA_TTL_HOURS=3` deletes everyone's documents and
  conversations three hours after they were made. Both are off unless set.
- Guests are deleted by the worker after `GUEST_TTL_HOURS` (default 24), with their workspace, documents and files. The
  lifetime counts from sign-in, not from last use.
- The web app sends no `script-src` policy, because Next writes inline scripts that a strict one needs a per-request
  nonce for ([threat model](THREAT-MODEL.md)).
