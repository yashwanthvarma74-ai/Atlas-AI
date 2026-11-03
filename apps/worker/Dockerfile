# Build from the repository root:  docker build -f apps/worker/Dockerfile -t atlas-worker .
FROM node:22-slim AS build
WORKDIR /app
# every workspace's manifest is needed so that npm ci can read the lockfile
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/eval/package.json ./apps/eval/package.json
RUN npm ci
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN npm run build -w @atlas/worker && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app/apps/worker
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/apps/worker/package.json ./package.json
# uploads and the OCR language model are written here
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
CMD ["node", "dist/main.js"]
