# ADR-0003 — TMDB metadata: plain `fetch` client, id-first matching, JSON on `media`

- Status: accepted (owner, 2026-10-23 — the five A options validated as proposed)
- Date: 2026-10-23
- Deciders: owner
- Related: UC2 ([spec](../specs/tmdb-metadata.md)), ADR-0001, ADR-0002, issue #4

## Context

UC1 stores one `media` row per file with what the file name gives: `kind`, `title`,
`year`, `season` / `episode`, `providerIds`. The catalog (#5) needs what the owner asked
for on 2026-10-23: browse by **genre**, by **best rating**, and by **type** (films /
series / documentaries / others), with a synopsis, a poster and the cast on each title.
TMDB is the provider (vision, data-flow 06: only a title and a year ever leave the
server). Five choices were open; each gets its matrix below. Scores are estimates unless
marked verified; the API facts come from the TMDB v3 reference read through Context7
on 2026-10-23.

## 1. HTTP client

- **A** — plain `fetch` (Node ≥ 22) behind a `TmdbClient` interface, responses parsed
  with zod (only the fields we read); the `fetch` function is injected so tests mock HTTP.
- **B** — `tmdb-ts` (npm, typed wrapper of v3, Bearer auth).
- **C** — `moviedb-promise` (npm, older wrapper, callback heritage).

| Criterion                        | Weight | A                                                   | B                                                | C                                        |
| -------------------------------- | -----: | --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| KISS / YAGNI (surface used)      |     30 | 5 — five operations, one function each              | 2 — hundreds of methods, 5 used                  | 2 — same                                 |
| Testability (HTTP mocked)        |     25 | 5 — inject `fetch`, assert the exact URL            | 3 — mock the module or `fetch` under it          | 3 — same                                 |
| Type safety of what we read      |     20 | 4 — zod schemas we own, strict, no `any`            | 4 — typed, but trusts the wire                   | 2 — loose typings                        |
| Maintenance / supply-chain risk  |     15 | 5 — no dependency                                   | 3 — one more package to audit                    | 2 — less active                          |
| Coverage of the API (future)     |     10 | 2 — every new endpoint is ours                      | 5 — everything already there                     | 4                                        |
| **Total / 500**                  |    100 | **450**                                             | 310                                              | 245                                      |

Points: A = 150+125+80+75+20 = 450 · B = 60+75+80+45+50 = 310 · C = 60+75+40+30+40 = 245.
Sensitivity (Coverage 40, KISS 10, others unchanged → sum 110,
renormalised to 100: Coverage 36, KISS 9, Test 23, Types 18, Maint 14): A ≈ 45+115+72+70+72
= 374, B ≈ 18+69+72+42+180 = 381 — B edges ahead only when "future API coverage" weighs
more than a third of the decision, which contradicts YAGNI for a five-operation client
(search, find, details, season, image — six TMDB endpoints behind them).
**A.**

## 2. Matching strategy

- **A** — id first, then title + year: a `[tmdbid-…]` tag fetches the details directly,
  an `[imdbid-…]` tag goes through `/find`, otherwise `/search/movie?query&year` (or
  `/search/tv?query&first_air_date_year`); the pure matcher keeps the first candidate
  whose year equals the parsed year, else (no parsed year) the first result; an empty
  year-filtered search is retried once without the year.
- **B** — title + year only (ignore the tags).
- **C** — fuzzy scoring (normalised title similarity × year distance × popularity).

| Criterion                          | Weight | A                                                      | B                                           | C                                                   |
| ---------------------------------- | -----: | ------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------- |
| Precision on the owner's files     |     35 | 5 — a tag is an exact answer; year filter handles remakes | 3 — remakes / homonyms pick the popular one | 4 — better on messy names, same on clean ones       |
| Determinism / testability          |     25 | 5 — pure, every branch a fixture                       | 5                                           | 3 — thresholds to tune, brittle tests               |
| Requests per title                 |     20 | 4 — 1 (tag) or 2–3 (search + details)                  | 4 — 2–3                                     | 3 — may fetch several pages                         |
| KISS                               |     20 | 4 — ~40 lines                                          | 5 — ~20 lines                               | 2 — scoring code to own                             |
| **Total / 500**                    |    100 | **460**                                                | 410                                         | 315                                                 |

Points: A = 175+125+80+80 = 460 · B = 105+125+80+100 = 410 · C = 140+75+60+40 = 315.
Sensitivity (KISS 40, Precision 15): A = 75+125+80+160 = 440, B = 45+125+80+200 = 450 —
B wins only when simplicity outweighs correctness, yet the tags are already parsed by
UC1 and ignoring an exact id would be a regression. **A.**

## 3. What to persist and where

- **A** — scalar columns on `media` (`tmdbId`, `overview`, `releaseDate`, `runtimeMin`,
  `voteAverage`, `voteCount`, `posterPath`, `backdropPath`, `metadataFetchedAt`) plus two
  JSON columns `genres` (`[{id, name}]`) and `cast` (`[{name, character, profilePath}]`,
  top 10 by billing order). Documentaries are **derived** (`genres` contains TMDB id 99),
  not a new `kind`: `kind` stays structural (film / episode / series / unknown).
- **B** — normalised tables `genres`, `media_genres`, `people`, `media_cast`.
- **C** — one `metadata` JSON blob column holding the raw TMDB payload.

| Criterion                                 | Weight | A                                                        | B                                                    | C                                                 |
| ----------------------------------------- | -----: | -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Serves the catalog rows (#5)              |     30 | 5 — rating / date are columns, genres via `json_each` or in JS on a few hundred rows | 5 — SQL joins                 | 2 — everything through JSON paths                 |
| KISS / YAGNI                              |     30 | 5 — one migration, no joins, no people table            | 2 — four tables for data nobody edits                | 4 — one column                                    |
| Type safety / contract clarity            |     20 | 5 — typed JSON mode, shared `Genre` / `CastMember`      | 5                                                    | 1 — raw provider shape leaks into the API         |
| Documentary distinction                   |     10 | 4 — derived from genre 99, `kind` untouched             | 4 — same                                             | 3 — same, buried                                  |
| Future (people pages, filters)            |     10 | 3 — a `people` table can be extracted later             | 5                                                    | 2                                                 |
| **Total / 500**                           |    100 | **470**                                                  | 400                                                  | 250                                               |

Points: A = 150+150+100+40+30 = 470 · B = 150+60+100+40+50 = 400 · C = 60+120+20+30+20 = 250.
Sensitivity (Future 30, KISS 10): A = 150+50+100+40+90 = 430, B = 150+20+100+40+150 = 460 —
B wins only when person pages (not in the MVP) weigh three times the simplicity. **A.**
`kind` extension rejected: a documentary is a film or a series *and* a genre; a fifth
kind would break every `kind === 'film'` branch of UC1 for a presentation concern.

## 4. Artwork caching

- **A** — download the poster (`w500`) and the backdrop (`w1280`) once per matched title
  into `data/artwork/<sha256(size + tmdbPath)>.<ext>`; the TMDB path is validated
  (`^/[A-Za-z0-9]+\.(jpg|png)$`) before it is used in a URL, the file name is the digest
  (never the provider string), the folder is created under the data dir and the serving
  route `GET /artwork/:file` accepts only `^[a-f0-9]{64}\.(jpg|png)$`. Cast photos are
  **not** downloaded in the MVP (`profilePath` stored, the web player must not load them
  from TMDB directly: the viewer's IP would leave the server — follow-up).
- **B** — store the TMDB paths only; the browser loads `image.tmdb.org` directly.
- **C** — download every size TMDB offers plus cast photos.

| Criterion                      | Weight | A                                                  | B                                              | C                                              |
| ------------------------------ | -----: | -------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Privacy (data-flow 06)         |     35 | 5 — the browser never talks to TMDB                | 0 — every viewer's IP and titles go to TMDB    | 5                                              |
| Simplicity                     |     25 | 4 — one download helper, one route                 | 5 — nothing to store                           | 2 — sizes × kinds × people                     |
| Disk / bandwidth               |     20 | 4 — ~100 KB + ~300 KB per title                    | 5 — zero                                       | 1 — tens of MB per title                       |
| Catalog needs (#5)             |     20 | 5 — poster grid + hero backdrop                    | 4 — works, slower, leaks                       | 5                                              |
| **Total / 500**                |    100 | **455**                                            | 305                                            | 345                                            |

Points: A = 175+100+80+100 = 455 · B = 0+125+100+80 = 305 · C = 175+50+20+100 = 345.
Sensitivity: B needs Privacy ≤ 5 to win; the vision rules it out. **A.** Verified
facts: poster sizes `w92 … w780, original`, backdrop sizes `w300, w780, w1280, original`
(`GET /configuration`, Context7). The two sizes are constants; the base URL
`https://image.tmdb.org/t/p/` is read from the configuration endpoint on the first image
download of the client's life and cached (forgotten if the call fails). Hardening added
at review: the announced base URL must be `https://image.tmdb.org`, image fetches follow
no redirect, and a body over 10 MB (announced or actual) is refused — an image we would
never want on disk, far above a w1280 backdrop (~500 KB).

## 5. Trigger, refresh and rate limit

- **A** — two entry points sharing one service: `POST /libraries/:id/scan` chains the
  enrichment of the rows that have no metadata yet when `TMDB_API_KEY` is set (the
  «include» of UC1 in the validated use-case diagram; a TMDB failure never fails the scan,
  the report carries a `metadata` section or `null`), and `POST /libraries/:id/enrich`
  (UC2) with `{ refresh?: boolean }` re-runs it on demand — `refresh: true` re-fetches
  every row. Requests run **sequentially** (TMDB allows ~50 req/s; one at a time stays
  far below), a `429` waits `Retry-After` (capped at 10 s) and retries once, any other
  failure marks the title `failed` in the report and moves on. Unmatched titles get
  `metadataFetchedAt` set with no `tmdbId`, so a plain run does not re-ask TMDB for
  them; `refresh` does.
- **B** — enrichment only through the explicit endpoint (the scan stays pure).
- **C** — enrichment inside the scanner, per file, as it is stored.

| Criterion                              | Weight | A                                                       | B                                              | C                                                      |
| -------------------------------------- | -----: | ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Conformance to the validated UML (UC1 includes the fetch) | 30 | 5                                              | 2 — the include disappears                     | 5                                                      |
| Isolation of the scanner (ADR-0002, tests) |     25 | 5 — composition in the route; scanner untouched         | 5                                              | 1 — scanner gains an HTTP dependency, 82 tests touched |
| Owner UX (one call after adding files) |     20 | 5                                                       | 2 — two calls                                  | 5                                                      |
| Resilience (TMDB down ≠ scan failed)   |     15 | 5 — separate phase, separate report                     | 5                                              | 3 — per-file failures mixed with probe failures        |
| KISS                                   |     10 | 3 — two routes, one service                             | 5                                              | 2                                                      |
| **Total / 500**                        |    100 | **480**                                                 | 350                                            | 340                                                    |

Points: A = 150+125+100+75+30 = 480 · B = 60+125+40+75+50 = 350 · C = 150+25+100+45+20 = 340.
Sensitivity (KISS 40, Conformance 0): A = 125+100+75+120 = 420, B = 125+40+75+200 = 440 —
B only wins when the validated UML counts for nothing. **A.**

## Decision

1-A plain `fetch` client · 2-A id-first then title + year · 3-A columns + JSON on
`media`, documentary derived from genre 99 · 4-A poster `w500` + backdrop `w1280` cached
by digest under `data/artwork`, served by `GET /artwork/:file` · 5-A scan chains the
enrichment, `POST /libraries/:id/enrich { refresh }` for UC2, sequential requests, one
retry on 429.

Episodes: a matched series fetches one `GET /tv/{id}/season/{n}` per season present in
the library (one request per season, not per episode) and stores each episode's name,
overview, still (`posterPath` holds the still for an episode), air date and rating.
Series-level cast comes from `GET /tv/{id}?append_to_response=credits`.

Language: `TMDB_LANGUAGE` (default `en-US`) is the only other configuration value; it
goes out as the `language` query parameter and carries no personal data.

## Consequences

- One new runtime dependency, `@fastify/static`, serving `GET /artwork/:file` from
  `ARTWORK_DIR` with `serve: false` (CodeQL flags a hand-rolled file read as
  `js/missing-rate-limiting`). `TMDB_API_KEY` holds the API Read Access Token (the only
  credential TMDB accepts as Bearer; the v3 key would travel in URLs), is read once by
  `loadConfig`, passed to the client factory, never logged (the error handler already
  hides messages; the key only travels in the `Authorization` header and a
  `TmdbRequestError` carries the path and status only).
- One `LibraryLock` per library, held by the scan route across the walk and the included
  enrichment and by the enrich route: without it an enrichment in flight could save a
  match for a file a concurrent scan had just re-parsed (the scanner and the service
  carry no guard of their own; the exclusion lives where concurrent requests arrive).
- Replacing `title` by TMDB's would break UC1's series grouping (episodes are attached by
  title + year), so migration `0002_parsed-title` adds `parsed_title`, written by the scan
  only and back-filled from `title`; `findOrCreateSeries` matches on it.
- Per-title failures are reported by title in the response and logged with their cause
  (`warn`), so a DB error or a schema drift is distinguishable from TMDB being down.
- A file UC1 finds changed has its `metadataFetchedAt` reset (a new title, year or tag
  deserves a new lookup), and a series with an episode never looked up is pending again,
  so files added later are enriched by a plain run.
- Migration `0001_tmdb-metadata` adds nullable columns only; existing rows are
  "pending" and the first scan or enrich fills them.
- The web player (#5) reads posters from `/artwork/<digest>.jpg`; it never builds a TMDB
  URL. Cast photos are a documented gap until a follow-up decides whether to cache them.
- A second provider would call for a `MetadataProvider` port; today the interface is
  the single `TmdbClient` (component diagram note on flat layering).
