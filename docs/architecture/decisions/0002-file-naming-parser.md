# ADR-0002 — File-naming parser: own regex parser

- Status: accepted (owner, 2026-10-22, after the deeper analysis below)
- Date: 2026-10-22
- Deciders: owner
- Related: UC1 ([spec](../specs/library-scan.md)), issue #3

## Context

The scan (UC1) must turn a file path into a film (`title`, `year`) or an episode
(`series`, `season`, `number`) before TMDB (UC2) can enrich it. The owner's files follow
the Plex/Jellyfin conventions: `Title (2019).mkv` for films and
`Show/Season 01/Show S01E02.mkv` for episodes, with occasional `1x02` or missing years.
The parser is called once per file, is pure, and must never import fs or process.

## Options

- **A** — Own regex parser: ~60 lines, two patterns (film year in parentheses, episode
  `SxxEyy` / `NxNN` with season from the parent folder as fallback).
- **B** — `@ctrl/video-filename-parser` (npm, MIT, v5.12.0, maintained 2026-10): a
  guessit-style parser for release names (quality, group, codec, edition, year, season).
- **C** — `parse-torrent-title` (npm, MIT, v3.0.1, 2026-04): lighter release-name parser,
  same family as B.

## Decision matrix (MCDA, weights sum to 100, scores 0–5)

| Criterion                             | Weight | A                                                        | B                                                             | C                                                          |
| ------------------------------------- | -----: | -------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Fit to the owner's naming (Plex-style) |     30 | 5 — the two patterns are exactly the owner's conventions | 3 — tuned for release names; `Title (2019)` works, folder-based season does not | 3 — same: no parent-folder season, title cleanup heuristics |
| KISS / YAGNI (no unused surface)      |     25 | 5 — nothing beyond title, year, season, episode          | 2 — quality, group, edition, audio… 90 % unused               | 3 — smaller, still release-oriented                        |
| Testability and determinism           |     20 | 5 — pure, every branch owned and unit-tested             | 4 — pure, but behaviour changes with upstream heuristics      | 4 — same                                                   |
| Maintenance risk (dependency)         |     15 | 4 — our code, but every new naming edge case is ours     | 3 — one more dependency to audit (Dependabot, CVE)            | 2 — smaller community, slower releases                     |
| Robustness on messy names             |     10 | 2 — unknown names fall back to the file stem (spec 5a)   | 5 — years of accumulated heuristics                           | 4 — good, fewer rules than B                               |
| **Total / 500**                       |    100 | **445**                                                  | 315                                                           | 315                                                        |

Points: A = 150+125+100+60+20 = **445** · B = 90+50+80+45+50 = **315** ·
C = 90+75+80+30+40 = **315**.

Sensitivity: A stays first even with "Robustness on messy names" weighted 40 and
"Fit" 10 (A 385 vs B 390 → only then does B edge ahead). The owner's files are
Plex-named by hand, so messy release names are not the target; the estimate that matters
is the share of files that fall into extension 5a, measurable on the real folder once
the scan runs.

## Verification (measured 2026-10-22, both libraries run on nine Plex-style names)

| Name                                              | A (own)                         | B `@ctrl/video-filename-parser`                                    | C `parse-torrent-title`                        |
| ------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| `Interstellar (2014).mkv`                         | title, 2014                     | ok, plus invented `resolution: 720P`, `sources: WEBDL`, `languages: English` | ok                                             |
| `Blade Runner 2049 (2017).mkv`, `1917 (2019).mkv` | title, year (parenthesised year wins) | ok                                                            | ok                                             |
| `Breaking Bad/Season 01/Breaking Bad S01E02.mkv`  | series, 1, 2                    | ok — but only if the caller passes `isTv = true`                    | ok                                             |
| `Dark/Season 02/Dark - 2x03 - Ghosts.mkv`         | series, 2, 3                    | ok                                                                 | `group: "Ghosts"` (episode title mis-read)     |
| `The Office S03E04E05.mkv` (double episode)       | 3, 4 (first episode; 5 ignored) | 3, [4, 5]                                                          | 3, 4 (second lost)                             |
| `Breaking Bad/Season 01/S01E02.mkv` (no name)     | series from the grandparent folder | `title: ""` — no folder context                                  | `title: "S01E02"`                              |
| `Home Video.mp4`                                  | stem, year null                 | `title: "Home Video.mp4"` (extension kept), invented `480P`, `TV`   | stem                                           |

Facts established:

- Neither library reads the folder context. Series name from the show folder and season
  from `Season NN` — the Plex convention the owner uses — must be written by us whatever
  the option. The libraries replace two regexes, not the parser.
- B needs the caller to decide film vs series up front (`isTv`); C guesses. Both invent
  release attributes (resolution, source, language) that are false on hand-named files
  and would have to be discarded.
- B handles the one case A does not: multi-episode files (`S03E04E05`). A can add it in
  one regex branch when a real file needs it (YAGNI now).
- Install footprint: B + C together 300 KB, no transitive dependency — cost is low, but
  nonzero (Dependabot, CodeQL, dependency review).

Widened options considered:

- **D** — hybrid: A first, B as a fallback when A finds nothing. Rejected: the fallback
  only fires on names A classifies as "unknown", where B invents attributes and still
  cannot use folder context; UC2 (TMDB search on the stem) is the better recovery.
- **E** — no parser: store the stem, let TMDB resolve everything. Rejected: TMDB search
  needs the year and season/episode to disambiguate (`1917`, remakes); the parse is
  the input of UC2, not a substitute for it.

Owner direction (2026-10-22): follow the Plex and Jellyfin conventions. Their documented
forms (spec § Technology and data variations) add provider-id tags
(`[tmdbid-123]`, `{tmdb-123}`, `[imdbid-tt…]`), editions / versions, multi-part files,
`Season 00` specials, episode ranges and extras folders. None of the libraries parses the
provider-id tags or the extras folders, which are the forms that matter most for UC2 and
for a clean catalog; they would be written by hand on top of B or C anyway. The own
parser grows to ~120 lines, still pure, one test per documented form.

The matrix stands: A 445, B 315, C 315. The verification moved nothing in the scores;
it confirmed the "fit" and "KISS" cells on which the decision rests (B's `title: ""` on
`S01E02.mkv`, C's `group: "Ghosts"`).

## Decision

Option A — an own pure parser in `apps/server/src/library/name-parser.ts`, exported
functions `parseFilm`, `parseEpisode`, `parseMediaName`. Unknown names fall back to the
file stem (spec extension 5a); UC2 (TMDB search) is the recovery path, not more regex.

## Fallback

Option C / B (315/500, tie — B preferred for its maintenance activity): a drop-in behind
the same `parseMediaName` signature, activated only if the measured share of unparsed
files on the real library exceeds what UC2's search can recover.

## Consequences

- No new runtime dependency in this brick.
- Every supported naming form is an explicit test case; an unsupported one is a new
  test + a new regex branch, reviewed like any code.
