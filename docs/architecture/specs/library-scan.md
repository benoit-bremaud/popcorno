# UC1 — Scan a media folder into a library

> **Feature**: Library domain — [use cases](../diagrams/playback/01-use-case.md)
> **Issue**: #3 · **Related ADRs**: ADR-0001, ADR-0002
> Format: Cockburn fully-dressed use case.

## Goal in context

The owner points Popcorno at a folder of their own media files and gets a browsable
library: every video file becomes a `Media` (film or episode) with its technical streams
probed, ready for metadata enrichment (UC2, issue #4) and the catalog (issue #5).

## Scope and level

System (Popcorno server). User-goal level.

## Primary actor

Owner.

## Stakeholders and interests

- **Owner** — wants every file found, nothing invented, a scan that can be re-run safely.
- **Viewer** — wants the catalog to reflect the folder (no ghost entries, no duplicates).

## Preconditions

- A library exists (`POST /libraries` with `name`, `rootPath`, `kind` in `films | series`).
- `rootPath` is an absolute, existing, readable directory equal to or under the server's
  `MEDIA_ROOT` (`POST /libraries` rejects any other path with `400 invalid_request`).
- `ffprobe` is reachable at `FFPROBE_PATH`.

## Minimal guarantees

- A failure on one file never aborts the scan: the file is reported in the result, the
  rest of the folder is processed.
- No path outside the library root is ever stored (traversal guard on every file; the
  real path is what gets probed and stored, never the link name).
- A file still present on disk is never removed, whatever happened to it during the
  pass (probe failure, unreadable neighbour, unmounted root).

## Success guarantees

- Every supported video file under the root (`.mkv .mp4 .m4v .webm .avi .mov`,
  recursive) has exactly one `Media` row with its `StreamInfo` rows.
- Re-running the scan is idempotent: unchanged files are left as they are, new files are
  added, missing files are removed.
- The response reports `{ added, updated, removed, skipped: [{ path, reason }] }`; the
  API exposes each file by its path relative to the root, never the absolute path.

## Trigger

The owner calls `POST /libraries/:id/scan`.

## Main success scenario

1. Owner calls `POST /libraries/:id/scan`.
2. System loads the library; its root is used as the only allowed base path.
3. System walks the root recursively and keeps the files whose extension is supported.
4. For each file, System resolves the real path, reads its size and mtime, and checks
   the real path stays under the root; the file now counts as seen.
5. System probes the real path with `ffprobe` (duration, streams: type, codec, width,
   height, language) unless the stored fingerprint is unchanged (7b).
6. System parses the relative path into a `ParsedName` (film: title + year; episode:
   series title, season, number) with the pure name parser (ADR-0002).
7. System upserts the `Media` row keyed by `(libraryId, filePath)` and replaces its
   `StreamInfo` rows; an episode is attached to a `series` `Media` (title + year)
   created on demand.
8. After the walk, System deletes the `Media` rows of this library whose real path was
   not seen, then the `series` rows no episode points to.
9. System returns `200` with the scan report.

## Extensions

- **2a. Library not found** → `404 { error: 'library_not_found' }`; use case ends.
- **2a'. Malformed library id** → `400 { error: 'invalid_request' }`; use case ends.
- **2b. Root does not exist or is not a directory** → `409 { error: 'root_unreadable' }`;
  use case ends.
- **3a. A sub-directory cannot be read** (permissions) → it is listed in `skipped` with
  reason `unreadable`; the walk continues with its siblings and step 8 is skipped
  (`removed` 0): the rows under that directory may still be valid.
- **3b. The walk finds no file at all** (empty or unmounted root) → step 8 is skipped;
  the rows stay until a scan sees the files again.
- **4b. The file cannot be resolved** (dangling symlink, stat failure) → listed in
  `skipped` with reason `unreadable`; it does not count as seen. Continue at 3.
- **4a. The resolved path escapes the root** (symlink to `/etc`, `..` segment) → the file
  is listed in `skipped` with reason `outside_root`; nothing is stored. Continue at 3.
- **4c. The file is an extra** (Plex/Jellyfin extras folder below the title folder, or a
  `-trailer` / `.sample` suffix) → listed in `skipped` with reason `extra`; nothing is
  stored, it does not count as seen. Continue at 3.
- **5a. ffprobe fails or times out on the file** (corrupt, not a video) → listed in
  `skipped` with reason `probe_failed`; nothing is written, a row from an earlier pass
  is kept (the file is still there). Continue at 3.
- **6a. The name does not match any known pattern** (no year for a film, no `SxxEyy` for
  an episode) → the file is stored anyway with `title` = file stem and `year` null
  (film) or `kind` `unknown`; `skipped` is not used because the file is playable. UC2
  will try to resolve it later. Continue at 7.
- **7a. Duplicate** — two files parse to the same film (`title`, `year`) or the same
  episode (`series`, `season`, `number`) → both are stored (one `Media` per file; the
  key is the file path). The catalog (issue #5) decides how to present duplicates; the
  scan never drops a file silently.
- **7b. The file is unchanged** (same size and mtime as the stored row) → probing and
  parsing are skipped, the row counts as neither added nor updated. Continue at 3.
- **\*a. A scan of the same library is already running** → `409 { error: 'scan_running' }`.

## Technology and data variations

- Supported extensions are a constant in the scanner; adding one is a one-line change.
- **Naming conventions supported (owner rule 2026-10-22: follow Plex and Jellyfin)** —
  sources: [Jellyfin movies](https://jellyfin.org/docs/general/server/media/movies/),
  [Jellyfin shows](https://jellyfin.org/docs/general/server/media/shows/), Plex naming
  guides (support.plex.tv, confirmed via the Plex forum for the episode range form).

  | Form                                                          | Parsed as                                         |
  | ------------------------------------------------------------- | ------------------------------------------------- |
  | `Title (2019).mkv` · `Title (2019)/Title (2019).mkv`          | film, year 2019 (folder name used when the file has none) |
  | `Title (2019) [tmdbid-123].mkv` · `[imdbid-tt123]` · `{tmdb-123}` · `{imdb-tt123}` | film + provider id, handed to UC2 (#4)      |
  | `Title (2019) - Director's Cut.mkv` · `{edition-Director's Cut}` | film, `edition` label (one `Media` per file); ` - 1080p` / ` - 4K` are versions, not editions |
  | `Title (2019)-cd1.mkv` (`cd`, `dvd`, `part`, `pt`, `disc`, `disk`) | film, `part` number                          |
  | `Show (2008)/Season 01/Show S01E02 Title.mkv`                 | episode: series "Show" (the show folder wins over the file prefix), year 2008, season 1, episode 2 |
  | `Show/Season 01/Show S01E02-E03.mkv` · `S01E02E03` · `s01e02-03` | episode range 2–3 (one `Media`, `episodeEnd` 3) |
  | `Show/Season 01/S01E02.mkv` · `Show/Season 01/1x02.mkv`       | series from the show folder, `NxNN` fallback       |
  | `Show/Season 00/Show S00E01.mkv` · `Show/Specials/Some Special.mkv` | special, season 0                           |
  | `Title (2019)/extras/`, `trailers/`, `behind the scenes/`, … (below the title folder) and `*-trailer.mkv`, `*.sample.mkv` | listed in `skipped`, reason `extra` |

  Text after the episode code is the episode title (ignored for matching, as Plex does).
  Not supported in the MVP, listed as `unknown` and still playable: date-based episodes
  (`Show - 2011-11-15.mkv`), absolute numbering, multi-season files, `VIDEO_TS` / `BDMV`
  folders, `.iso`.
- The "streaming-site" inspiration (rows, hero, continue watching) belongs to the catalog
  and player bricks (#5, #7, #9); the scan only has to produce the data they need: kind,
  title, year, season/episode, provider id, edition, duration, streams.

## Related information

- Frequency: on demand, a few times a week at most. Synchronous for the MVP; a job
  queue appears only if a scan exceeds the HTTP timeout on a real library.
- Security: ADR-0001 dependency rule — the scanner imports `fs` and spawns `ffprobe`
  through a single runner; the parser and the path guard are pure functions. The API has
  no authentication yet: the server listens on loopback by default and library roots are
  confined under `MEDIA_ROOT` (owner decision 2026-10-23, local review Must 4).
- Scale: the pruning diff runs in JS and deletes by chunks, so a library of any size stays
  under SQLite's bind-variable limit; the walk has no depth or file cap in the MVP.

## Acceptance criteria (issue #3)

- `POST /libraries/:id/scan` fills `media` and `streams` for a fixture folder.
- Unit tests: parser and path guard (pure), scanner on a real temporary folder with an
  in-memory SQLite and a fake prober (the only double), routes via `inject`.
- Coverage ≥ 80 % enforced in the Vitest config.
