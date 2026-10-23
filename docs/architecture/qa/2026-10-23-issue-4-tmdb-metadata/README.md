# QA pass — issue #4 TMDB metadata — 2026-10-23 (mocked TMDB, review-fixed tree)

**No real TMDB key was available**, so TMDB is a local double: `fake-tmdb.mjs` (Node, port
3199 on loopback) answers the five operations the server uses, and `redirect-fetch.mjs`
(preloaded with `node --import`) points the server's `fetch` at it for the two TMDB hosts.
The production client code runs unchanged: URL building, Bearer header, `language`, host
pin on `image.tmdb.org`, digest naming, serving route. What the double cannot prove is
the real API's payload shape and the real rate limit — both are covered by the
Context7-verified schemas and the unit tests (`tmdb-client.test.ts`), and must be
re-checked on first use with a real key (follow-up in the Nice issue).

Server: `node dist/index.js` (built tree, same code as the PR head) on port 3102, `HOST`
default (loopback), fresh `DATABASE_PATH`, `MEDIA_ROOT` = fixture `$S/media` (two FFmpeg
clips: `The Matrix (1999).mkv` → matched by the double, `Home Video.mkv` → unmatched),
`ARTWORK_DIR=$S/data/artwork`, `TMDB_API_KEY=qa-fake-key`. Real `ffprobe`.

## Transcript — `transcript.txt`

| Step | Result |
| --- | --- |
| `GET /health` | 200 |
| `POST /libraries` (films) | 201 |
| `POST /libraries/:id/scan` | 200, `added: 2`, `metadata: { matched: 1, unmatched: [Home Video], failed: [], skipped: 0 }` |
| `GET /libraries/:id/media` | The Matrix carries `tmdbId 603`, overview, 2 genres, cast, rating, two digest-named artwork files; Home Video has `tmdbId null` with `fetchedAt` set |
| `GET /artwork/<digest>.png` | 200, `image/png`, `content-length: 70`, `cache-control: public, max-age=31536000, immutable`; `artwork-served.png` is the served file (valid 1×1 PNG) |
| `GET /artwork/..%2Fpopcorno.sqlite` | 400 `invalid_request` (regex param) |
| `GET /artwork/<64 × a>.jpg` | 404 `artwork_not_found` |
| `POST /enrich` (plain) | `skipped: 2`, no TMDB request |
| `POST /enrich {refresh:true}` | matched 1 / unmatched 1 again; artwork files reused (no second image download in the double's log) |
| `POST /enrich {refresh:"yes"}` | 400 `invalid_request` |
| `POST /enrich` on an unknown id | 404 `library_not_found` |
| Server log | 0 warn / 0 error lines; the key string appears in no log (server or double) |
| Double's log | only `query`, `year`, `include_adult`, `language`, `append_to_response` in URLs; `Authorization` present on API calls, absent on image downloads |

No-key mode (port 3103, no `TMDB_API_KEY`): scan returns `metadata: null`, `POST /enrich`
answers `409 tmdb_not_configured`, the start-up log says
`TMDB_API_KEY not set: metadata enrichment disabled`.

Not exercised here (unit-tested only): the 429 retry (the double's one-off 429 was
consumed by a manual `curl` before the scan — see request 1 in the log), the series /
season path, the oversize-image and foreign-base-URL refusals.
