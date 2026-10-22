# Project log — Popcorno

Chronological operational logbook (newest first). Complements `git log` with the human
context: merged PRs, decisions, tags, infra events. Not a release changelog — that is
`CHANGELOG.md`.

## 2026-10-22 — #3 Library scan (PR pending)

- **Conception gate** — textual Cockburn spec UC1 (`docs/architecture/specs/library-scan.md`),
  sequence diagram `02-sequence-scan-library.md`, ADR-0002 file-naming parser: own regex
  parser (A, 445/500) vs `@ctrl/video-filename-parser` (B, 315) vs `parse-torrent-title`
  (C, 315); owner asked for a deeper analysis, both libraries were run on nine Plex-style
  names (neither reads folder context or provider-id tags), then validated A. Owner
  direction: follow the Plex and Jellyfin naming conventions (ids, editions, parts,
  episode ranges, specials, extras folders) — recorded in the spec.
- **Implementation** — Drizzle + better-sqlite3 schema (`libraries`, `media`, `streams`),
  migration `0000_library-scan`, pure name parser and path guard, `ffprobe` runner as the
  single process egress, scanner (idempotent on size + mtime, deletes missing files,
  reports skipped files with a reason), routes with zod validation. 37 unit tests,
  coverage 95.7 % lines / 90.9 % branches (threshold 80 % in `vitest.config.ts`).
- **QA** — real server + `ffprobe 8.0.1` on a generated fixture (corrupt file, extras folder,
  symlink to `/etc`): `docs/architecture/qa/2026-10-22-issue-3-library-scan/`.
- **Local review (2026-10-23, `review-local` on 57d355c)** — five dimensions reconciled in
  `docs/architecture/review-local.md`: 6 Must, 14 Should, 12 Nice. Gate RED on doc
  coverage (78 %) and the Must list. All Must + Should applied: a present file is never
  pruned (seen before probing; no pruning while a directory is unreadable or the root is
  empty), the guard's real path is what gets probed and stored, pruning diff in JS with
  chunked deletes (SQLite bind limit), **owner decision Must 4 (MCDA A 440/500)**: library
  roots confined under `MEDIA_ROOT`, `HOST` defaults to `127.0.0.1` (Docker sets
  `0.0.0.0`), API exposes `relativePath` instead of the absolute path, generic 500
  handler, series keyed by title + year, parser regex fixes (part separator, plausible
  year, anchored edition suffix, resolution labels, extras only below the title folder,
  show folder wins), `as const` kind lists shared by zod and Drizzle, JSON column mode,
  docs re-aligned (ADR-0002 arithmetic 445 → 455, diagrams 02/03/04, spec). Migration
  `0001_media-relative-path` adds the column. SonarQube then failed on 7 new code smells
  (regex backtracking, cognitive complexity, `await` in a loop) — cleared in `f5788f3`
  (gate PASSED, 0 issue). Tests 37 → 82, coverage 98.0 % stmts / 95.0 % branches, doc
  coverage 100 %. Second QA pass `qa/2026-10-23-issue-3-library-scan-r2/`. Nice items
  filed as a follow-up issue. Gotcha: pass the SonarQube token through an exported
  variable, not `VAR=… cmd -D…="$VAR"` (zsh expands the argument first → 401).

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
