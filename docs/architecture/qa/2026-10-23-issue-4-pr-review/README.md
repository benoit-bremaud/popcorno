# QA pass — issue #4 TMDB metadata — 2026-10-23 (after the PR review rounds)

Replay of the first QA pass (`../2026-10-23-issue-4-tmdb-metadata/`) on the tree that
went through the CodeQL and Codex review rounds of PR #16. Same set-up: the built server
(`node dist/index.js`) on loopback, real `ffprobe`, two FFmpeg fixtures (`The Matrix
(1999).mkv` matched by the double, `Home Video.mkv` unmatched), and the **local TMDB
double** `fake-tmdb.mjs` reached through `redirect-fetch.mjs`. No real TMDB key was
available; a replay against the real API stays a follow-up (#15).

## Transcript — `transcript.txt`

| Step | Result |
| --- | --- |
| `GET /health` | 200 |
| `POST /libraries/:id/scan` | 200, `added: 2`, `metadata: { matched: 1, unmatched: [Home Video], skipped: 0 }` |
| `GET /libraries/:id/media` | The Matrix: `tmdbId 603`, digest-named poster; Home Video: `tmdbId null`, looked up |
| `GET /artwork/<digest>.png` | 200 via `@fastify/static`: `image/png`, `content-length: 70`, `cache-control: public, max-age=31536000, immutable`; `artwork-served.png` is the served file |
| `GET /artwork/..%2Fqa.sqlite` | 400 `invalid_request` |
| `GET /artwork/<64 × a>.jpg` | 404 `artwork_not_found` (scoped not-found handler) |
| `POST /enrich` plain / `{refresh:true}` | `skipped: 2` / matched 1, unmatched 1 |
| `POST /enrich` bad body / unknown id | 400 `invalid_request` / 404 `library_not_found` |
| Scan and refresh started together | scan 200, enrich **409 `enrich_running`** (shared `LibraryLock`) |

## Logs

- `fake-tmdb.log`: request 1 answers 429, request 2 is the **retry** (exercised this
  time). The poster then the backdrop download one after the other (requests 6 and 7). The
  `Authorization` header is present on API calls only. Only title, year and fixed
  parameters appear in the URLs.
- Server log: no occurrence of the key. The one warn of this run came from
  `@fastify/static` (`"root" path … must exist` on a fresh install). Fixed by creating
  `ARTWORK_DIR` at start-up. `startup.log` is a fresh start after the fix: one info line,
  no warn.

Not exercised here (unit-tested only): the series and season path, the oversize-image
stream cap, the foreign base URL refusal.
