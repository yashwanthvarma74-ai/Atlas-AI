# Build from the repository root:  docker build -f apps/web/Dockerfile -t atlas-web .
# API_URL is where /api/* is proxied to. Next compiles rewrites into the build, so it is a build argument and
# changing it means building the image again.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/eval/package.json ./apps/eval/package.json
RUN npm ci
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
ARG API_URL=http://api:4002
ENV API_URL=$API_URL
RUN npm run build -w @atlas/web && npm prune --omit=dev

FROM node:26-slim
WORKDIR /app/apps/web
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/shared /app/packages/shared
COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/package.json ./package.json
COPY --from=build /app/apps/web/next.config.ts ./next.config.ts
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3002/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npx", "next", "start", "--port", "3002"]
