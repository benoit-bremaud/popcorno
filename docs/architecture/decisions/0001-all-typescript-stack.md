# ADR-0001 — All-TypeScript pnpm monorepo

- Status: accepted
- Date: 2026-10-22
- Deciders: owner

## Context

Popcorno needs an HTTP server (API, file serving, FFmpeg control) and a web player. The
heavy work — probing and transcoding video — is done by FFmpeg as an external process
whatever the server language. The owner's other projects are all TypeScript; this is a
solo, personal MVP.

## Options

- **A** — TypeScript full-stack: Fastify + React/Vite, pnpm workspace.
- **B** — Go server + React front.
- **C** — Rust server + React front.

## Decision matrix (MCDA, weights sum to 100, scores 0–5)

| Criterion                      | Weight | A                                  | B                                | C                              |
| ------------------------------ | -----: | ---------------------------------- | -------------------------------- | ------------------------------ |
| Owner mastery                  |     30 | 5 — every project is TS            | 2 — read, not written daily      | 1 — new language               |
| Development speed              |     25 | 5 — one language, one toolchain    | 3 — two toolchains               | 2 — slow compile, steep curve  |
| Streaming performance          |     20 | 3 — FFmpeg does the heavy lifting  | 5 — lean concurrency             | 5 — lean concurrency           |
| Ecosystem (HLS, TMDB, player)  |     15 | 5 — hls.js, fastify plugins        | 4 — good HTTP, fewer media libs  | 3 — fewer media libs           |
| Simplicity (KISS)              |     10 | 5 — single CI, single lint         | 4                                | 2                              |
| **Total / 500**                |    100 | **460**                            | 335                              | 245                            |

Sensitivity: A stays first with performance weighted 40 and mastery 10. B overtakes A
only with performance ≥ 50, which does not match a home server with a handful of streams.
Performance scores are estimates (not measured); they only matter beyond dozens of
simultaneous streams.

## Decision

Option A. Fastify 5, React 19 + Vite, Drizzle + better-sqlite3, zod, pino, hls.js.
FFmpeg is driven as a child process; direct play streams the file as-is.

## Fallback

Option B (Go server, 335/500) — a design change, not a drop-in: the API contracts in
`packages/shared` stay, the server package is rewritten. Activate only if measured CPU
or memory on the target machine proves Node insufficient.

## Consequences

- One language, one lint/test/CI chain; fast iteration.
- Node's single thread is never on the hot path: file serving uses streams, transcoding
  is FFmpeg.
- Must keep the server lean (no heavy frameworks) to honour the Raspberry Pi target.
