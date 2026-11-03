# Deploying

**Status: not deployed.** No hosting account was used, so there is no live link. What follows is what was run
and what was not.

## Verified: the whole app in containers on one machine

```bash
JWT_SECRET=$(openssl rand -base64 48) docker compose --profile app up --build
# open http://localhost:3002 and press "Continue as guest"
```

This builds three images (API, worker, web), starts MongoDB with Atlas Search and Redis beside them, and was run
end to end: guest sign-in, upload, indexing by the worker container, search, a streamed answer, and a tool request
waiting for approval. The API and the worker share one volume for uploads, which is why this works on one machine.

Settings that matter:

- `JWT_SECRET` is required. The API refuses to start in production with the development one.
- `COOKIE_SECURE=false` is set in the compose file only because it serves plain HTTP. Behind HTTPS leave it unset, so
  the session cookie is `Secure`.
- `API_URL` is a **build** argument of the web image: Next compiles the proxy target into the build.
- `EMBEDDING_PROVIDER` and `LLM_PROVIDER` default to the offline ones. Set `openai`, `anthropic` or `ollama` and the
  matching key for real answers, and **re-run the evaluation**: the best chunk size depends on the embedder.

## Not verified: managed hosting

The spec's suggested split is Vercel for the web app, Fly.io or Render for the API and worker, MongoDB Atlas (free
tier, which includes Atlas Search and Vector Search), Upstash Redis, and Cloudflare R2 for files. None of that was
tried. What it would need, from the code:

1. **Files in object storage.** The API and worker are separate processes, usually on separate machines, so
   `STORAGE_DRIVER=s3` with `S3_ENDPOINT`, `S3_BUCKET` and keys (R2 is S3-compatible). The S3 driver is tested against
   an S3 mock, not against R2.
2. **MongoDB Atlas.** Use its connection string as `MONGODB_URI`. The app creates its two search indexes on start.
   The vector index is tied to `EMBEDDING_DIMENSIONS`, so decide the embedder first.
3. **Redis** as `REDIS_URL`. BullMQ needs it to be a real Redis (it uses blocking commands).
4. **The web app and API on one site**, so the session cookie is first-party: the web app proxies `/api` to the API.
   If they are on sibling subdomains, set `COOKIE_DOMAIN`.
5. `SITE_ORIGIN` must be the web app's public URL: writes naming any other origin are refused.
6. `TRUST_PROXY_HOPS` must match the number of proxies in front of the API, or rate limits see the wrong address.

## Before pointing the public at it

- Keep `RATE_LIMIT_SCALE` at 1.
- The upload parser runs in the worker process with the database credentials and no sandbox
  ([threat model](THREAT-MODEL.md)). Run the worker in a container with no inbound network and a read-only
  filesystem except for `/data` and the temporary directory.
- Guests are deleted by the worker after `GUEST_TTL_HOURS` (default 24), with their workspace, documents and files. The lifetime counts from sign-in, not from last use.
