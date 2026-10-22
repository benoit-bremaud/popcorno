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
- **Scaffold** — repo skeleton (README, LICENSE MIT, CLAUDE.md, this log, CHANGELOG,
  SECURITY), pnpm workspace (`apps/server`, `apps/web`, `packages/shared`), ESLint +
  Prettier + Vitest, CI (`ci`, `gitleaks`, `codeql`, `dependency-review`, `scorecard`,
  `docker-security`), Dependabot, hardened Dockerfile + compose, SonarQube properties,
  vision document, first UML study of the `playback` feature, ADR-0001.
