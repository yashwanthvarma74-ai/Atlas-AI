# 0015. Containers, and the hardening that came with them

Status: accepted

## Context

The spec asks for `docker compose up` to run everything, hardening, and a deploy. No hosting account was used, so
the container build is what could be verified. Building it for real found problems that the tests had not.

## Decision

- **Three images** (API, worker, web), built from the repository root with the workspace manifests copied first so
  `npm ci` can read the lockfile. Each image runs as the unprivileged `node` user, carries production dependencies
  only, and the API and web have health checks.
- **`docker compose up -d`** starts only the backing services (Atlas Local and Redis). **`--profile app`** adds the
  three images, so the common case, developing from source, is not slowed by builds.
- **The API and worker share one volume for uploads.** That is correct on one machine and wrong across several, where
  `STORAGE_DRIVER=s3` is required. The compose file says so.
- **`API_URL` is a build argument of the web image.** Next compiles the proxy target into the build. The first version
  read it when the container started, the proxy kept pointing at `127.0.0.1`, and every API call through the web
  container returned 500 while the API itself was healthy. It was found by calling the containers, not by a test.
- **`COOKIE_SECURE`** can turn off the `Secure` flag, and exists only because the compose stack serves plain HTTP.
  It defaults to on in production.
- **Security headers.** The API uses `helmet`. The web app sends `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, and a Content-Security-Policy limited to `frame-ancestors`, `base-uri`,
  `object-src` and `form-action`. It has no `script-src`, because Next writes inline scripts that a strict one needs a
  per-request nonce for. That is a known gap, listed in the threat model, not an oversight.
- **`RATE_LIMIT_SCALE`** multiplies every per-address limit so a load test measures the service and not the limiter.
  It defaults to 1, and the deploy guide says that raising it removes a defence.
- **CI** builds the three images (the end-to-end job does it through `docker compose`) and runs the app in them.

## Evidence

The stack was run end to end in containers: guest sign-in, three uploads indexed by the worker container, search,
a streamed answer and a tool request waiting for approval. Headers were read off the running web container. A load
test ran against it (`docs/BENCHMARKS.md`).

## Not done

No metrics endpoint, and no sandbox for the parser beyond a child process ([ADR 0016](0016-traces-and-an-isolated-parser.md)). See [DEPLOY.md](../DEPLOY.md) and [SLOS.md](../SLOS.md).
