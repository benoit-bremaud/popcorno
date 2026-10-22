# syntax=docker/dockerfile:1
# Popcorno server image: builds the TypeScript workspace, ships only the runtime output,
# runs as a non-root user with FFmpeg available for transcoding.

FROM node:22.21.1-bookworm-slim AS build
# better-sqlite3 is compiled from source when no prebuilt binary matches: node-gyp needs
# python3 + a C++ toolchain. Build stage only; the runtime image ships the .node binary.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @popcorno/server...
COPY packages/shared packages/shared
COPY apps/server apps/server
# --legacy: pnpm 10 only deploys injected workspaces by default; the workspace keeps plain
# links so edits to packages/shared are seen live in dev (no injected hard-link copies).
RUN pnpm --filter @popcorno/server... build \
  && pnpm --filter @popcorno/server --prod deploy --legacy /out

FROM node:22.21.1-bookworm-slim
# ffmpeg comes from Debian stable: pinned by the base image tag, patched by Dependabot bumps.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=build --chown=1000:1000 /out /app
RUN mkdir -p /app/data /app/media && chown 1000:1000 /app/data /app/media
USER 1000
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 MEDIA_ROOT=/app/media
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
