# Project log — Popcorno

Chronological operational logbook (newest first). Complements `git log` with the human
context: merged PRs, decisions, tags, infra events. Not a release changelog — that is
`CHANGELOG.md`.

## 2026-10-22 — Project bootstrap

- **Project created** — name chosen among plaidou / popcorno / zapette (owner pick:
  popcorno; one homonym on GitHub, unrelated). Folder `~/Documents/02_personal/popcorno`,
  repository initialised on `main`.
- **Decisions**:
  - `stack` — all-TypeScript pnpm monorepo (Fastify + React/Vite + SQLite/Drizzle, FFmpeg
    as an external process). MCDA 460/500 vs Go + React 335 and Rust + React 245; see
    ADR-0001. Fallback: Go server (B), a design change, not a drop-in.
  - `scope` — the product serves the owner's own files only; no content source integrated.
- **GitHub** — public repository `benoit-bremaud/popcorno` created, initial commit
  `d86ad31` pushed to `main` (the only direct commit on `main`: bootstrap). GitHub Project
  #71 "popcorno" linked (Status: Todo / In Progress / Done). Milestone `v0.1.0 — MVP`
  with the seven MVP issues #3, #4, #5, #7, #8, #9, #10 (scan, TMDB, catalog, direct
  play, HLS, resume, profiles), all on the board in Todo. Dependabot opened its first
  action bumps the same minute (#1, #2, #6).
- **Scaffold** — repo skeleton (README, LICENSE MIT, CLAUDE.md, this log, CHANGELOG,
  SECURITY), pnpm workspace (`apps/server`, `apps/web`, `packages/shared`), ESLint +
  Prettier + Vitest, CI (`ci`, `gitleaks`, `codeql`, `dependency-review`, `scorecard`,
  `docker-security`), Dependabot, hardened Dockerfile + compose, SonarQube properties,
  vision document, first UML study of the `playback` feature, ADR-0001.
