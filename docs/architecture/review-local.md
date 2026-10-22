# Local review — popcorno (issue #3 library scan)

- Date: 2026-10-23
- Commit reviewed: 57d355c · fixes: 8ba4f3a (review findings) + f5788f3 (SonarQube findings)
- Scope: branch diff `main...HEAD` (35 files, apps/server + packages/shared + docs)
- Checks run: design (two independent passes) · docs · tests · security · correctness
- Verdict at review time: **fix Must Have first** · Must 6 · Should 14 · Nice 12
- Resolution: every Must and Should applied in 8ba4f3a (owner decision on Must 4: option A,
  MCDA 440/500); Nice items filed as a follow-up issue; Disagree items kept as designed.

## Pre-merge gate re-run (code SHA f5788f3; later commits are docs / QA evidence only)

| Step        | Result                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| 1 Tests     | ✅ 82 unit/integration (Vitest, 7 files) · no E2E suite yet (Playwright planned)                              |
| 2 Coverage  | tests ✅ 98.0 % stmts / 95.0 % branches / 94.5 % funcs / 97.8 % lines (floor 80) · docs ✅ 100 % (43/43 exports, floor 90) |
| 3 SonarQube | ✅ PASSED on f5788f3 (new code: 0 issue, 0 hotspot, 0 % duplication, 97.8 % coverage). The first scan on 8ba4f3a FAILED on 7 new code smells (two super-linear regexes, cognitive complexity 17, three `await` in a loop, object literal default) — all fixed in f5788f3, none waived |
| 4 Secrets   | ✅ gitleaks clean (`main..HEAD` and `--all`) · only `.env.example` tracked · diff read: nothing sensitive       |
| 5 QA pass   | ✅ full — real server on loopback + `ffprobe 8.0.1`, every route curled incl. `/etc` root rejected, idempotent re-scan, relative paths only, 0 server errors: `qa/2026-10-23-issue-3-library-scan-r2/` |

- Gate: **GREEN — merge authorised** once the PR review is handled (CI, Copilot, owner approval).

## Pre-merge gate (head SHA 57d355c, before fixes)

| Step        | Result                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| 1 Tests     | ✅ 37 unit/integration (Vitest, 7 files) · no E2E suite yet (Playwright planned)                              |
| 2 Coverage  | tests ✅ 95.7 % stmts / 90.9 % branches / 93.3 % funcs / 96.1 % lines (floor 80) · docs ❌ 78 % (29/37, floor 90) |
| 3 SonarQube | ✅ PASSED (`popcorno`, localhost:9000, first scan created the project)                                         |
| 4 Secrets   | ✅ gitleaks clean (`main..HEAD` and `--all`) · only `.env.example` tracked · diff read: nothing sensitive       |
| 5 QA pass   | ✅ full — real server + `ffprobe 8.0.1` on a generated fixture, every route curled, 0 server errors: `qa/2026-10-22-issue-3-library-scan/` |

- Gate: **RED — step 2 (doc coverage) and the Must Have list below**; re-run above on the fixed SHA.
- SonarQube note: the scanner's v2 bootstrap answered 401 when the token was passed as
  `VAR=… sonar-scanner -Dsonar.token="$VAR"` (zsh expands the argument before the
  assignment applies); `export` the variable first.

## 🔴 Must Have

1. `apps/server/src/library/scanner.ts:56-63` `[design×2|correctness]` · A file that is still on disk but
   skipped this pass (`probe_failed`, `stat` failure, everything under an unreadable directory, an empty
   or unmounted root) is treated as missing and deleted — cascading to streams and, later, to TMDB data
   and watch progress · Fix: push a file to `seen` as soon as it exists under the root; make `walk`
   return the unreadable directories and skip `deleteMissing` when any directory was unreadable or when
   the walk found no file while rows exist. Regression tests for each case.
2. `apps/server/src/library/scanner.ts:92-130` `[design|security]` · The path guard checks the resolved
   path but the scanner probes and stores the unresolved symlink; the stored path is safe only at scan
   time (TOCTOU) · Fix: probe, fingerprint and store the guard's result; keep the link name for parsing.
3. `apps/server/src/library/repository.ts:137,154,169` `[security|correctness|design]` · `notInArray` /
   `inArray` bind one SQL variable per path: a library above ~32 k files throws "too many SQL
   variables" after all the probing · Fix: diff in JS and delete by chunks of 500 ids; orphan series via
   a `NOT EXISTS` subquery; `listMedia` joins on `media.libraryId` instead of passing ids.
4. `apps/server/src/library/routes.ts:9-13`, `apps/server/src/config.ts:14` `[security|design]` · No
   authentication, any absolute `rootPath` accepted (`/`, `/etc`), server bound to `0.0.0.0` by default,
   `MEDIA_ROOT` read but never used · **Owner decision** (MCDA in chat): restrict roots under
   `MEDIA_ROOT` and default the host to loopback, or keep the open behaviour.
5. Documentation `[docs]` · 78 % of exports documented, floor 90 %: `AppOptions`, `AppDatabase`,
   `libraries` / `media` / `streams`, `LibraryRoutesDeps`, `SUPPORTED_EXTENSIONS`, `StreamType`,
   `SkippedFile`, plus `LibraryScanner.scan` contract (`@throws`) · Stale docs: ADR-0002 total for A is
   **455**, not 445 (decision unchanged, A still first by 140), sensitivity weights summed to 110, exported
   function list wrong, "first episode only" superseded by the range support; sequence diagram 02
   (`findStoredFile`, no `replaceStreams`, extras and `scan_running` branches, probe/parse order);
   component 03 (scanner → ffprobe edge); class 04 (`episode`, `episodeEnd`, `providerIds`, `edition`,
   `part`); spec 5a wording, 3a scope (files too), missing `400 invalid_request`, acceptance line "fs
   mocked" → temp dir.
6. `apps/server/src/library/scanner.test.ts:128-139` `[tests]` · `chmod 000` is a no-op as root
   (Docker CI) → false failure; restore not in `finally` · Fix: `it.skipIf(uid === 0)` + `try/finally`,
   and cover spec 3a deterministically with a dangling symlink (`unreadable` file branch). Add the
   missing spec 7a test (two files parsing to the same film / episode are both stored).

## 🟡 Should Have

- `repository.ts:89` `[design×2|correctness]` · series matched by title only (`Doctor Who (1963)` vs
  `(2005)` merge) · match on title + year (`IS NULL` aware).
- `name-parser.ts:137` `[design]` · text before the episode code wins over the show folder, so
  `Dark/Season 01/Dark.2017.S01E01.mkv` creates series "Dark 2017" · prefer the show folder title.
- `name-parser.ts:43` `[correctness]` · `PART_SUFFIX` separator optional and unanchored: `Concept2` →
  "Conce" part 2, `Rocky Part 2` loses its title · require a separator and the Plex hyphen form.
- `name-parser.ts:44` `[correctness]` · year not restricted to 19xx/20xx (`Film (1080)`) · `(?:19|20)\d{2}`.
- `name-parser.ts:76-79,170-175` `[correctness]` · `editionAfter` slices the stem with the folder's match
  offsets; `EDITION_SUFFIX` unanchored · use `fromStem` only, anchor the regex.
- `name-parser.ts:21-38` `[correctness]` · `EXTRA_SUFFIX` matches `The Other.mkv`, `Hot Clip.mkv`;
  `EXTRA_FOLDERS` swallows a top-level `Shorts/` library folder · hyphen/dot/underscore separators only
  (Jellyfin list), extras folders only below the title folder.
- `name-parser.ts:42,173` `[correctness]` · `- 1080p` / `- 4K` version labels become `edition` · filter
  resolution-like labels out (Jellyfin "version", not an edition).
- `scanner.ts:126-141`, `repository.ts:8-23`, `shared/index.ts` `[design×2]` · media fields restated in
  six places · `MediaInput = ParsedName & {...}` and spread; `LIBRARY_KINDS` / `MEDIA_KINDS` /
  `STREAM_TYPES` `as const` in shared reused by Drizzle enums and zod; `CreateLibraryBody = Omit<Library,'id'>`.
- `repository.ts:101,110,185` `[design]` · hand-rolled JSON for `providerIds` with an unchecked cast ·
  Drizzle `text(..., { mode: 'json' }).$type<ProviderIds>()` (verify no migration drift).
- `scanner.ts:77-144` `[design×2]` · `processFile` 68 lines, output parameter `skipped` · return the
  `SkipReason`, extract a `fingerprint()` helper; type `let probed` / `let entries`.
- `shared/index.ts:57`, `routes.ts:52` `[design|security]` · absolute server paths in the API · expose
  `relativePath`; keep the absolute path server-side only.
- `routes.ts` `[security]` · default Fastify 500 handler may echo SQLite messages · `setErrorHandler`
  logging the error and returning `{ error: 'internal' }`; zod `details` reduced to `path` + `message`;
  `rootPath` `.max(4096)`.
- `scanner.test.ts:11-14,113-124,75-93` `[tests]` · shared `vi.fn` with `mockImplementationOnce` leaks
  across tests; failure keyed on call order; 7b test changes size and mtime together · per-test fake,
  path-keyed failure, separate size-only / mtime-only cases; split the bundled tests.
- `routes.test.ts`, `vitest.config.ts` `[tests]` · no route test for `409 scan_running`, media 404,
  scan 400; `exclude` lacks `src/**/*.test.ts` · add them.

## 🔵 Nice to Have

- `scanner.ts:35` `[design×2|tests]` · `isRunning` only used by tests · remove, assert on `ScanRunningError`.
- `scanner.ts:67-75` `[design×2]` · redundant throw inside `try` · check `isDirectory` after the `try`.
- `scanner.ts:176` `[design]` · `extensionOf` re-implements `extname` · use `node:path`.
- `path-guard.ts:12` `[design×2|security|correctness]` · rejects `..foo.mkv`, dead `startsWith(sep)` ·
  `rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)`; add tests.
- `ffprobe.ts:37` `[design×2|security]` · magic `4 * 1024 * 1024`; pass `-i`, `killSignal: 'SIGKILL'`.
- `ffprobe.ts:39` `[design]` · `JSON.parse as FfprobeOutput` at a trust boundary · small zod schema.
- `repository.ts:188` `[design]` · O(media × streams) filter in `listMedia` · group into a `Map`.
- `repository.ts:37-62` `[design×2]` · `Library` column list ×3 · `libraryColumns` constant.
- `shared/index.ts:89` `[design]` · `ApiError.error` as a string union.
- `name-parser.ts:47` `[correctness]` · no `episodeEnd > episode` check (`S01E05-02`) · clamp to null.
- `scanner.ts:295` `[correctness]` · `relative()` yields `\` on Windows · normalise to `/` in reports.
- `scanner.ts:156-174` `[security]` · no walk depth / file-count cap, scans run in the request · cap
  (`MAX_DEPTH`, `MAX_FILES`); `202` + background job only if a real library exceeds the HTTP timeout.
- `name-parser.test.ts:84` `[tests]` · `for` loop → `it.each`; add the "not supported → unknown" table.
- `eslint.config.mjs` `[design]` · no `complexity` / `max-lines-per-function` rules.

## ⚪ Disagree / Intentional

- `scanner.ts:7,31` `[design×2]` · `LibraryScanner` depends on the concrete `LibraryRepository` · one
  implementation, tests use a real in-memory SQLite; an `ILibraryStore` now is speculative generality
  (03-component.md: a ports layer appears with a second implementation).
- `ffprobe.ts:14` `[design×2]` · `Prober` as a function type · the lightest port for the single process
  egress; a class would be ceremony.
- `scanner.ts:28` `[security|design]` · per-library in-memory lock, one global scan not enforced ·
  single-process MVP; the spec defers a job queue.
- `vitest.config.ts` `[tests]` · per-file thresholds · global 80 % floor is the owner rule; revisit if a
  file drops below.
- `repository.ts` `[tests]` · no direct unit tests · exercised through scanner and routes with a real DB.

## Per-dimension summary

- Design: dependency rule holds, no over-engineering; one real defect (seen vs processed) and a path
  TOCTOU; data clumps to derive rather than restate. · Docs: 78 % < 90 %, ADR arithmetic and three
  diagrams drifted from the code. · Tests: healthy pyramid, fake only at the process boundary; one
  root-sensitive test, 7a untested, a leaky shared double. · Security: no injection, parameterised SQL,
  symlinked dirs not followed; open `rootPath` + `0.0.0.0` is the owner's call; SQLite variable limit.
  · Correctness: four parser regex edge cases, series keyed by title only, deletion of present files.
