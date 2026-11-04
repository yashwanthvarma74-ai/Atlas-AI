# Build from the repository root:  docker build -f apps/api/Dockerfile -t atlas-api .
FROM node:26-slim AS build
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
COPY apps/api ./apps/api
RUN npm run build -w @atlas/api && npm prune --omit=dev
# the embedding and OCR models, fetched once here instead of on every start
COPY infra/fetch-models.mjs ./infra/fetch-models.mjs
RUN node infra/fetch-models.mjs /app/models
# ONNX Runtime ships binaries for every platform; this image only ever runs the Linux one
RUN rm -rf node_modules/onnxruntime-node/bin/napi-v*/darwin node_modules/onnxruntime-node/bin/napi-v*/win32

FROM node:26-slim
WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV MODEL_CACHE_DIR=/app/models
ENV OCR_CACHE_DIR=/app/models/tesseract
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/models /app/models
COPY --from=build /app/apps/api/package.json ./package.json
# uploads and the OCR language model are written here
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4002)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
