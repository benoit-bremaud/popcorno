# UC2 — Refresh metadata from TMDB

> **Feature**: Library domain — [use cases](../diagrams/playback/01-use-case.md)
> **Issue**: #4 · **Related ADRs**: ADR-0001, ADR-0002, ADR-0003
> Format: Cockburn fully-dressed use case. UC1 (`library-scan.md`) «includes» the main
> scenario below right after its walk; this document is the single description of it.

## Goal in context

Every scanned title (film or series, and each episode) carries what the catalog (#5)
shows and sorts on: the official title, a synopsis, a poster and a backdrop cached on the
server, the genres, the release date, the runtime, the TMDB rating and the main cast.
Documentaries are recognisable (TMDB genre 99 among the genres).

## Scope and level

System (Popcorno server). User-goal level.

## Primary actor

Owner.

## Stakeholders and interests

- **Owner** — wants the library to look like a streaming catalog without typing anything;
  wants a wrong match to be fixable by a `[tmdbid-…]` tag in the file name and a re-run.
- **Viewer** — wants posters and synopses; must never be exposed to TMDB (no personal
  data, not even an IP, leaves the server — data-flow 06).
- **TMDB** — fair use of a free key: no burst, no re-fetch of what is already known.

## Preconditions

- A library exists with scanned `media` rows (UC1).
- `TMDB_API_KEY` is set; otherwise UC2 answers `409 tmdb_not_configured` and UC1 skips
  its include (`metadata: null` in the scan report — also null when the include itself
  could not run, e.g. a run was already in flight; the cause is logged).

## Minimal guarantees

- A TMDB failure (network, 5xx, malformed payload) on one title never aborts the run nor
  the scan that included it: the title is reported `failed`, the next one is processed.
- Only the title and the year (and the provider id read from the file name) are ever sent
  to TMDB; the key travels in a header and is never written to a log or an error body.
- No file is written outside `data/artwork`; artwork file names are digests, never a
  string received from the provider.

## Success guarantees

- Every row that was pending, except those reported `failed`, has `metadataFetchedAt`
  set; matched rows carry `tmdbId`,
  `overview`, `genres`, `releaseDate`, `runtimeMin`, `voteAverage`, `voteCount`,
  `cast` (top 10), `posterPath` and `backdropPath` pointing at cached files; the stored
  `title` is replaced by TMDB's title for the configured language.
- Episodes of a matched series carry their own name, overview, still, air date and rating.
- The response reports `{ matched, unmatched: [{ title, year }], failed: [{ title, year }], skipped }`.

## Trigger

The owner calls `POST /libraries/:id/enrich` (body `{ refresh?: boolean }`), or UC1
reaches the end of its walk with the key configured.

## Main success scenario

1. Owner calls `POST /libraries/:id/enrich`.
2. System loads the library and lists its **pending** rows: films, series and `unknown`
   rows with `metadataFetchedAt` null, plus series with an episode row still null (added
   by a later scan); all rows when `refresh` is true. A file UC1 found changed (size,
   mtime) has its `metadataFetchedAt` reset, so it is pending again. Episodes are handled
   through their series (step 8).
3. For each pending title, one after the other:
4. System resolves a candidate: with `providerIds.tmdb` (a whole number), the id itself; with
   `providerIds.imdb`, `GET /find/{imdb}?external_source=imdb_id`; otherwise
   `GET /search/movie?query=<title>&year=<year>` for a film library,
   `GET /search/tv?query=<title>&first_air_date_year=<year>` for a series library. The
   pure matcher keeps the first candidate whose year equals the parsed year, else the
   first result when no year was parsed.
5. System fetches the details with the credits in one request
   (`GET /movie/{id}?append_to_response=credits` or `GET /tv/{id}?append_to_response=credits`).
6. The pure mapper turns the payload into a `MetadataInput`: title, overview, genres
   (`{id, name}`), release / first-air date, runtime (`runtime` or the first
   `episode_run_time`), vote average and count, poster and backdrop TMDB paths, the ten
   first cast members by `order` (`name`, `character`, `profilePath`).
7. System caches the poster (`w500`) and the backdrop (`w1280`): the TMDB path is
   validated, the image downloaded once (no redirect followed, at most 10 MB) into
   `data/artwork/<sha256(size + path)>.<ext>` (an existing file is reused), and the file
   name is what gets stored.
8. For a series, System groups the library's episodes of that series by season, calls
   `GET /tv/{id}/season/{n}` once per season, and stores on each episode row the matching
   `episode_number`'s name, overview, still (cached like a poster, in `posterPath`), air
   date and rating; a multi-episode file (`episodeEnd`) takes the first episode's data.
9. System saves the row (`metadataFetchedAt` = now, `title` replaced by TMDB's) and
   counts it `matched`.
10. After the last title, System returns `200` with the report.

## Extensions

- **1a. Malformed id** → `400 invalid_request`. **1b. Unknown library** → `404 library_not_found`.
- **1c. Body invalid** (`refresh` not a boolean) → `400 invalid_request`.
- **2a. No key configured** → `409 { error: 'tmdb_not_configured' }`; use case ends.
- **2b. A run on the same library is in flight** → `409 { error: 'enrich_running' }`.
- **2c. Nothing pending** → `200` with zeros (`skipped` = rows left untouched).
- **4a. The search returns nothing with the year** → retried once without the year; the
  matcher then requires the year to be within ±1 of the parsed one, else the title is
  `unmatched`: `metadataFetchedAt` is set with `tmdbId` null so it is not re-asked until
  a `refresh`. Continue at 3.
- **4b. The provider id is unknown to TMDB** (404) → same as 4a (`unmatched`); the owner
  fixes the tag in the file name and re-scans (UC1 re-parses a renamed file).
- **4c–8c. TMDB answers 429** on an API request → wait `Retry-After` seconds (default 1,
  capped at 10 so a run never stalls on a provider hint), retry once; a second 429 counts
  as a failure (5a). Image downloads are not retried (7a).
- **5a. Any request fails** (network, 15 s timeout, 5xx, payload fails validation) → the
  title is reported `failed` and the cause logged, nothing is written for it (a later run
  retries it, since `metadataFetchedAt` stays null). Continue at 3.
- **7a. Artwork download fails** (error status, oversize, redirect, base URL not
  `https://image.tmdb.org`) → the row is saved without that path (`null`), the cause
  logged; the title still counts as `matched`, the next run with `refresh` fetches it again.
- **7b. TMDB has no poster / backdrop** (`null` path) → nothing downloaded, path `null`.
- **8a. Any failure fetching a season** (404, network, invalid payload) → its episodes
  stay as parsed (title from the file name), the cause is logged, the series itself is
  `matched`.
- **8b. An episode number is absent from the season payload** → that row keeps its
  fields (parsed, or from an earlier run), only `metadataFetchedAt` is set so the catalog
  can tell it was looked up.
- **\*a. Included in UC1** — the scan route runs steps 2–10 after the walk with
  `refresh` false; its report gains `metadata: EnrichReport | null` (null when 2a, or
  when the include threw — 2b — which is logged, never fails the scan).

## Technology and data variations

- Authentication: `Authorization: Bearer <TMDB_API_KEY>` (works for a v3 key or a v4
  read token); `language=<TMDB_LANGUAGE>` on every request (default `en-US`).
- Image base URL read lazily from `GET /configuration` (`images.secure_base_url`) on the
  first image download of the client's life, then cached (forgotten when that call
  fails); it must be `https://image.tmdb.org/…`, anything else is refused. Sizes are
  constants (`w500` poster / still, `w1280` backdrop) validated against the reference on
  2026-10-23. Every request times out after 15 s.
- `POST /libraries/:id/enrich` is synchronous: the response comes after the last title
  (a few minutes for a 500-title first run); a run in flight answers `409` meanwhile.
- `GET /artwork/:file` answers `Cache-Control: public, max-age=31536000, immutable`: a
  digest-named file never changes content, so the browser may keep it for a year.
- `unknown` rows (UC1 extension 6a) are searched as films in a films library and as
  series in a series library, with no year: this is the recovery path ADR-0002 promised.
- Documentaries: genre id 99 (`Documentary`, both movie and TV lists). The catalog
  derives its "documentaries" row from `genres`; no column, no new `kind`.

## Related information

- Frequency: once after each scan; a few titles a week. Sequential requests keep the
  rate far under TMDB's limit (~50 req/s); a 500-title first run is ~1 500 requests, a
  few minutes.
- Security: the client is the single HTTP egress of the server (component diagram); it
  receives `fetch` by injection so tests never open a socket. The artwork cache is the
  only writer under `data/artwork` and validates every name it writes or serves.

## Acceptance criteria (issue #4)

- After `POST /libraries/:id/scan` with a key configured, `GET /libraries/:id/media`
  returns rows with `metadata` (title, overview, poster path, cast, genres, rating).
- `GET /artwork/:file` serves a cached poster with the right content type and rejects any
  other name with `400`; a missing file is `404`.
- Unit tests: matcher and mapper (pure fixtures), client against an injected fake
  `fetch` (URL, headers, 429 retry, key never in errors, base URL pinned, size cap),
  artwork cache on a temporary
  folder, service on an in-memory SQLite with a fake client, routes via `inject`.
- Coverage ≥ 80 % (threshold in `vitest.config.ts`), no network in tests.
