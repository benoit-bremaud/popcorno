# Project log — Popcorno

Chronological operational logbook (newest first). Complements `git log` with the human
context: merged PRs, decisions, tags, infra events. Not a release changelog — that is
`CHANGELOG.md`.

## 2026-10-24 — #8 HLS transcode (PR #29 merged, `76df1fd`)

- **Conception** — spec `docs/architecture/specs/hls-transcode.md`, sequence 02 and state
  05 refined, ADR-0006 with six owner-validated MCDA matrices: every Play posts
  `/playback/sessions`, the server confirms direct play with `directPlayMime` or opens an
  in-memory HLS session; H.264/AAC copied, the rest re-encoded; MPEG-TS EVENT playlist.
- **Implementation** — pure `ffmpeg-args`, `transcoder` (only child-process egress), a
  `SessionManager` (limit reserved before any await, 60 s idle watchdog, crash and close
  cleanup, start-up removal of FFmpeg-owned `session-*` dirs only), session routes with a
  name whitelist. Web: Play for every file with video, hls.js 1.7.3 loaded on demand and
  preferred over native HLS (Chromium claims HLS it cannot demux), one session per player
  (StrictMode-safe), 20 s heartbeat.
- **Reviews** — local review: 4 Must fixed (session-limit race, `rm -rf` of a configurable
  dir, S6819, stale docs). Codex: 9 findings over 5 rounds, 8 fixed (cover art in ffprobe +
  re-probe migration 0003, integer session limit, even scaled height, owned-dir cleanup,
  tool text leaked into four docs, native HLS errors), 1 deferred to #28. CodeQL
  `js/missing-rate-limiting` on the `onReady` hook dismissed as a false positive (owner,
  A 480).
- **Gate** on `c67eef6` — 16 shared + 245 server + 67 web tests, coverage server 98.3 % /
  web 100 % lines, SonarQube PASSED, gitleaks clean, CI 9/9. QA: real HEVC + AC-3 MKV via
  HLS in Chromium and Firefox, close and idle cleanup verified
  (`qa/2026-10-23-issue-8-hls-transcode/`). Squash-merged with owner approval.
- **Filed** — #26 (*arr tools explanation session), #27 (rename to PopCornTV: .com for
  sale, npm and GitHub names used by torrent projects), #28 (FFmpeg reaping on crash,
  input check/open race).

## 2026-10-23 — #7 direct play (PR #22 merged, `aadad38`)

- **Conception** — the spec `docs/architecture/specs/direct-play.md` and the sequence
  `02-sequence-direct-play.md` are in place, and the component diagram is updated.
  ADR-0005 is owner-validated: a pure `decidePlayback` in shared fed by `canPlayType`
  (A 485 vs session 375), and an own single-range route (A 475 vs `@fastify/send` 355).
- **Implementation** — `GET /media/:id/file` answers 200, 206, 416 or 404
  `media_not_found`. The path guard re-runs on every request, then the file is opened
  once with `O_NOFOLLOW` and streamed from that handle. A malformed or multi-range header
  gets 200 (RFC 9110). `isAtOrUnderRoot` is now shared. The web gets a Play button in
  `DetailDialog`, one per episode for a series, and a native `<video>` player in a nested
  `<dialog>`. React propagates `close`, so the detail dialog guards it.
- **Gate** — 16 shared + 191 server + 42 web tests, coverage ≥ 98 %, gitleaks clean,
  CI 9/9. QA: play and seek checked in Chromium and Firefox
  (`qa/2026-10-23-issue-7-direct-play/`). Codex hit its quota, so the owner asked for a
  local `/code-review` (high) instead. It found no bug and 2 cleanups, both applied.
- **Owner decisions** — the empty `<track>` was dropped and S4084 accepted in SonarQube
  (B 380), and SonarQube then PASSED. The per-request guard cost is kept (A 450).
  Squash-merged with owner approval.
- **Filed** — #23 (direct-play follow-ups: ETag/If-Range, HEAD, bit depth, autoplay hint)
  and #24 (WebVTT subtitles).

## 2026-10-23 — #5 catalog grid (PR #20 merged, `b3a3afa`)

- **Conception** — the spec `docs/architecture/specs/catalog-grid.md` covers a benchmark of
  Plex, Jellyfin, Netflix, Disney+ and Prime, plus UC3 / UC4. The catalog diagrams (use case,
  sequence, component, controls state) are in place. ADR-0004 holds the design tokens:
  palette A 480, Inter 450, reducer 440. Its v2 adds discreet gold, navy and violet accents
  plus motion tokens. The vision now records coexistence with the *arr tools (450 / 380 / 170).
- **Implementation** — the React catalog has a hero, rows by type, genre and top rated, and
  progressive-disclosure controls. It also has a native `<dialog>` detail view whose
  openings are versioned by a `seq` against the queued close event. No new server endpoint
  was added (YAGNI).
- **Gate** — 33 web tests at 100 % lines. The Playwright smoke passed 8/8 repeats. SonarQube
  PASSED after 7 fixes (S6819, S6847, S4624). CI was 12/12 green. The Codex P2 findings were
  fixed and answered inline. QA rounds 1–3 are in `qa/2026-10-23-issue-5-catalog-grid/`.
  Squash-merged with owner approval.
- **Filed** — #18 (users, email verification, remote access) and #19 (cast to LAN devices).

## 2026-10-23 — #4 TMDB metadata (PR #16 merged, `dfaaa61`)

- **PR review** — CodeQL raised 2 alerts and Codex 15 findings over five rounds. All were
  fixed and answered inline; the sixth Codex round was clean. Owner MCDA decisions:
  `@fastify/static` for the artwork route (B 430), read access token only (B 450),
  `parsed_title` grouping key with migration 0002 (B 445), one `LibraryLock` shared by scan
  and enrich (A 445). Other fixes: revisits keep the stored match, a single TMDB request
  queue per server, an image cap enforced while streaming, poster / backdrop / stills
  downloaded sequentially.
- **Final gate (2219a4c)** — 157 tests, 98.05 % stmts, SonarQube PASSED, gitleaks clean,
  CI 9/9. QA replayed with the TMDB double (`qa/2026-10-23-issue-4-pr-review/`). The 429
  retry and the lock were exercised. One start-up warn was fixed by creating `ARTWORK_DIR`
  at boot. Squash-merged with owner approval; issue #4 is Done.

- **Conception gate** — Cockburn spec UC2 (`docs/architecture/specs/tmdb-metadata.md`),
  sequence diagram `02-sequence-enrich-metadata.md`, class / component / data-flow updates,
  ADR-0003 with five MCDA matrices (TMDB v3 verified through Context7): plain `fetch`
  client (A 450/500), id-first then title + year with a ±1 retry (A 460), scalar columns +
  JSON `genres` / `cast` on `media` with documentary derived from genre 99 (A 470), poster
  `w500` + backdrop `w1280` cached by digest under `ARTWORK_DIR` and served by
  `GET /artwork/:file` (A 455), scan chains the enrichment + `POST /libraries/:id/enrich
  { refresh }` with sequential requests and one 429 retry (A 480). Owner validated the five
  A options as proposed (`0a83afb`).
- **Implementation** (`fabd3bc`) — `src/metadata/`: zod-validated TMDB client (single HTTP
  egress, injected `fetch`), pure matcher / mapper, artwork cache (write-then-rename,
  digest names), repository, service, routes; migration `0001_tmdb-metadata` (nullable
  columns only); `ScanReport.metadata`; shared contracts; README / `.env.example` /
  CHANGELOG / CLAUDE.md. 135 tests.
- **Local review (`review-local` on fabd3bc)** — five dimensions reconciled in
  `docs/architecture/review-local.md`: 7 Must (2 SonarQube smells, 5 stale doc claims),
  20 Should, 11 Nice. All Must + Should applied: image downloads capped at 10 MB, base URL
  pinned to `https://image.tmdb.org` with no redirect, bounded provider strings, a
  rescanned changed file is looked up again, a series with a newly added episode is
  pending again, absent episodes keep their fields (`markLookedUp`), failures logged
  through an injected logger, deterministic concurrency tests, `sequentially()` helper
  (SonarQube S9382 forbids `await` in a loop, the global TS rule forbids `.then()`
  chains). Tests 135 → 146, coverage 98.3 % stmts / 93.5 % branches, doc coverage 100 %,
  SonarQube PASSED, gitleaks clean. QA with a **mocked TMDB** (no key available):
  `docs/architecture/qa/2026-10-23-issue-4-tmdb-metadata/`. Nice items filed as issue #15.

## 2026-10-22 → 2026-10-23 — #3 Library scan (PR #14 merged)

- **Merged** — PR #14 squash-merged into `main` on 2026-10-23 as `1763c9c`, closing #3.
  The Nice-to-have findings of the local review are tracked in issue #13.

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
  docs re-aligned (ADR-0002 arithmetic 445 → 455, diagrams 02/03/04, spec). The schema
  change was folded into the single initial migration `0000_library-scan` (nothing
  deployed yet; owner decision, MCDA A 440/500 vs keeping a `0001` ALTER). SonarQube then failed on 7 new code smells
  (regex backtracking, cognitive complexity, `await` in a loop) — cleared in `f5788f3`
  (gate PASSED, 0 issue). Tests 37 → 82, coverage 98.0 % stmts / 95.0 % branches, doc
  coverage 100 %. Second QA pass `qa/2026-10-23-issue-3-library-scan-r2/`. Nice items
  filed as a follow-up issue. Gotcha: pass the SonarQube token through an exported
  variable, not `VAR=… cmd -D…="$VAR"` (zsh expands the argument first → 401).
- **PR #14 review + CI (2026-10-23)** — Codex findings fixed in `477b1f0`: an unreadable
  file disables pruning (P1), the library root's real path is checked against the real
  `MEDIA_ROOT` at scan time (P2), the relative path joins the unchanged fingerprint and a
  second link to a seen file is reported `duplicate` (P2). CI then exposed that the Docker
  image never started: `pnpm deploy` v10 refuses non-injected workspaces (`--legacy`) and
  Node refuses to strip types under `node_modules`, so `@popcorno/shared` now builds to
  `dist/` (types from `src/`, Vitest aliases `src/`) — `f2c8e12`. Trivy image then blocked
  on 17 fixed Debian CVEs (perl, pcre2, gnutls, libcap) the node base image lags behind:
  `apt-get upgrade` in the runtime layer, DL3005 waived inline with the reason. Lesson: a
  local image build is verified by running the container (`/health`, `/proc/1/status`),
  not by its exit code.

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
