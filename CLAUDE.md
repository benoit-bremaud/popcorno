# CLAUDE.md — Popcorno

Project context for any AI agent session. Inherits the machine-global rules in
`~/.claude/CLAUDE.md` and `~/.agent-rules/common.md`; this file only adds what is specific
to Popcorno.

## What this project is

A self-hosted media server + web player built from scratch, taking the best of Jellyfin
(free, self-hosted), Plex (automatic metadata) and Netflix (browsing and playback UX). It
serves the owner's own media files only — no content source is ever integrated.

## Working method

Conception precedes code (owner rule, conception gate in `common.md`):

1. Requirements — `docs/requirements/`
2. UML 2.5 in Mermaid (skill `uml-diagram-new`) — `docs/architecture/diagrams/<feature>/`
3. Decisions — MADR ADRs with an MCDA matrix — `docs/architecture/decisions/`
4. Implementation, one issue per brick, tests mandatory

## Stack (ADR-0001)

All-TypeScript pnpm monorepo. `apps/server` (Fastify 5, Drizzle + better-sqlite3, pino,
zod), `apps/web` (React 19 + Vite, hls.js), `packages/shared` (contracts). FFmpeg is an
external process driven by the server (HLS transcode when the browser cannot direct-play).
Metadata from TMDB. Node ≥ 22.

Hard rules: TypeScript strict, no `any`, named exports only, design tokens for colors /
spacing / typography, tests with every feature (Vitest unit, Playwright e2e later).

## Conventions

- Chat in French; code, comments, commits, PR bodies, docs in English.
- Conventional Commits; dedicated branch off `main` per issue; PR closes the issue.
- Every chat is named `#N Issue title` and works on that single issue.
- Log every merged PR and decision in `PROJECT_LOG.md` (skill `project-log-discipline`).
- Containers follow skill `docker-hardening` (non-root, HEALTHCHECK, pinned bases, Hadolint,
  Trivy).

## Git / GitHub

- Local git email `bbd.concept@gmail.com` (personal); GitHub account `benoit-bremaud`.
- Repo **public** until the first production deployment, then private (owner rule
  2026-10-15; Public Release Checklist in the global `CLAUDE.md`).
- Default labels only until a label triptych is adopted in a dedicated PR.

## Useful commands

- `pnpm install` — install the workspace (`better-sqlite3` and `esbuild` builds allowed).
- `pnpm dev:server` — Fastify API on <http://localhost:3000> (`GET /health`). Builds
  `packages/shared` first: its `exports` point types at `src/` and the runtime at `dist/`
  (Node refuses to strip types under `node_modules`, which is where the Docker image puts
  it). Re-run after editing the shared contracts; tests alias `src/` and need no build.
- `pnpm dev:web` — Vite dev server on <http://localhost:5173> (`/api` proxied to the server).
- `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm test` · `pnpm coverage` ·
  `pnpm build`.
- `make lint-docker` · `make scan-docker-config` · `make scan-docker-image IMAGE=…`.

## Current state

MVP bricks, one issue each. Done: bootstrap (repo, tooling, CI, Docker, vision, UML,
ADR-0001); #3 library scan (spec `docs/architecture/specs/library-scan.md`, ADR-0002 own
name parser, Drizzle schema `libraries` / `media` / `streams`, routes `POST|GET
/libraries`, `POST /libraries/:id/scan`, `GET /libraries/:id/media`; library roots are
confined under `MEDIA_ROOT`, `HOST` defaults to loopback); #4 TMDB metadata (spec
`docs/architecture/specs/tmdb-metadata.md`, ADR-0003: plain `fetch` client, id-first
matching, metadata columns + JSON `genres` / `cast` on `media`, documentary derived from
genre 99, artwork cached by digest under `ARTWORK_DIR`, scan chains the enrichment,
`POST /libraries/:id/enrich`, `GET /artwork/:file`); #5 catalog grid (ADR-0004); #7 direct
play (spec `docs/architecture/specs/direct-play.md`, ADR-0005: pure `decidePlayback` in
`packages/shared` fed by `canPlayType`, `GET /media/:id/file` with single-range 206 and the
path guard re-run per request, Play + native `<video>` player in `DetailDialog`); #8 HLS transcode (spec
`docs/architecture/specs/hls-transcode.md`, ADR-0006: every Play posts `/playback/sessions`,
the server confirms direct play with `directPlayMime` or runs FFmpeg into an in-memory
session — H.264/AAC copied, the rest re-encoded, MPEG-TS EVENT playlist, 60 s idle
watchdog + 20 s web heartbeat, hls.js loaded on demand); #9 resume (spec `docs/architecture/specs/resume-playback.md`,
ADR-0007: `watch_progress` keyed by `profile_id` `'default'` until #10, `PUT
/media/:id/progress` every 10 s / on pause / on close, `GET /progress`, `startSec` →
FFmpeg `-ss` + `offsetSec` in the answer, Next episode button). Next: #10 profiles.

Server layout (flat, component diagram 03): `src/library/` holds the pure `name-parser`
and `path-guard`, the `ffprobe` runner (only process egress), the `scanner`, the per-library
`lock` (scan + included enrich and explicit enrich never overlap), the Drizzle `repository`
and the `routes`; `src/playback/` the pure `range` parser, the
streaming `routes`, the pure `ffmpeg-args`, the `transcoder` (only child-process egress,
`spawn` injected), the `session-manager` and the `session-routes`; `src/progress/` the `watch_progress`
`repository` and its `routes`; `src/metadata/` the `tmdb-client` (only HTTP egress,
`fetch` injected), the pure `matcher` (match + map), the `artwork-cache`, its
`repository`, the `service` and the `routes`; `src/http.ts` the route helpers; `src/db/`
the schema and `openDatabase` (migrations in `apps/server/drizzle`, generated by
drizzle-kit — build `packages/shared` first — applied at start).
