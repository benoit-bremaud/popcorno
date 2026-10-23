# ADR-0005 — Direct play: browser-side pure decider, own single-range streaming route

- Status: accepted (owner validated the weights, #7 chat, 2026-10-23)
- Date: 2026-10-23
- Deciders: owner
- Related: UC5 ([spec](../specs/direct-play.md)), ADR-0001, ADR-0004, issue #7

## Context

#7 plays a scanned file in the browser when the browser decodes it natively. There are
two choices to make: where the direct-play decision runs, and how the bytes are served
with HTTP Range. Scores are estimates unless marked verified.

## 1. Where the direct-play decision runs

- **A — Pure `decidePlayback` in `packages/shared`, called by the web app** with
  `HTMLVideoElement.canPlayType`. No server session for direct play. #8 reuses the same
  function server-side when it adds `POST /playback/sessions` for HLS.
- **B — `POST /playback/sessions` now** (sequence 02 as drawn): the client sends its
  capabilities and the server decides.
- **C — No decision**: the client tries `<video>` on every file and falls back on `error`.

| Criterion                                         | Weight | A                                                  | B                                                   | C                                                  |
| ------------------------------------------------- | -----: | -------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Correctness (the right files offered)             |     30 | 5 — the browser's own `canPlayType` answers        | 4 — needs the client to list capabilities anyway    | 2 — MKV/H.264 often starts in Chromium then fails  |
| KISS / YAGNI for #7                               |     25 | 5 — one pure function, no endpoint                 | 2 — session table/state for a mode that needs none  | 5                                                  |
| Testability (pure unit tests)                     |     20 | 5                                                  | 4                                                   | 1 — only e2e                                       |
| Path to #8 (HLS reuses it)                        |     15 | 4 — server imports the same function               | 5 — already in place                                | 1                                                  |
| UX (no dead Play button)                          |     10 | 5                                                  | 5                                                   | 1                                                  |
| **Total / 500**                                   |    100 | **485**                                            | 375                                                 | 230                                                |

Points: A = 150+125+100+60+50 = 485 · B = 120+50+80+75+50 = 375 ·
C = 60+125+20+15+10 = 230.
Sensitivity: raising "path to #8" to 30 (others renormalised) keeps A first
(A ≈ 4.8/5, B ≈ 3.9/5). **A.** The sequence diagram 02 keeps the session for the HLS
branch only; [02-sequence-direct-play](../diagrams/playback/02-sequence-direct-play.md)
shows the #7 flow.

## 2. How the Range route serves bytes

- **A — Own single-range parser + `fs.createReadStream({ start, end })`** in
  `apps/server/src/playback/` (~60 lines, unit-tested parser).
- **B — `@fastify/static`** rooted at each library root, `reply.sendFile(relative, root)`.
- **C — `@fastify/send`** on the guarded absolute path.

| Criterion                                         | Weight | A                                                       | B                                                         | C                                                |
| ------------------------------------------------- | -----: | ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Security (confinement through our `path-guard`)   |     35 | 5 — guard then open the exact path, nothing else served | 3 — plugin resolves paths itself; one root per library is awkward | 4 — path checked by us, plugin handles dotfiles |
| KISS / no new dependency                          |     25 | 4 — small owned code                                    | 2 — new plugin, decorates the app globally                | 3 — new dependency                               |
| Spec fit (206/416/200, MIME, streaming)           |     20 | 5 — exactly the spec, no ETag/multi-range surface       | 4 — more than needed (ETag, caching)                      | 4                                                |
| Testability                                       |     20 | 5 — pure parser + `inject`                              | 3                                                         | 3                                                |
| **Total / 500**                                   |    100 | **475**                                                 | 295                                                       | 355                                              |

Points: A = 175+100+100+100 = 475 · B = 105+50+80+60 = 295 · C = 140+75+80+60 = 355.
Sensitivity: doubling "spec fit" to 40 (others renormalised) keeps A first. **A.**

## Decision

1-A and 2-A. `decidePlayback` and its codec table live in `packages/shared/src/playback.ts`;
`GET /media/:id/file` lives in `apps/server/src/playback/` (route + pure `parseRange`); a new
error code `media_not_found`. The web adds a Play button in `DetailDialog` and a
`PlayerDialog` on the native `<video controls>` — no hls.js until #8.

## Consequences

- No playback session nor progress tracking yet (#8, #9).
- Container from the extension is a heuristic: a misnamed file is caught by extension 3a
  (media `error`) at play time.
- `canPlayType("maybe")` is accepted: Firefox answers `maybe` for most valid MP4 strings.
- No `<track>` on the player yet: subtitles are not served, and an empty track would offer
  a captions entry that does nothing. SonarQube S4084 is accepted on `PlayerDialog.tsx`
  (owner decision, 2026-10-23, MCDA 380/500 vs 355 for an empty track); real WebVTT
  subtitles are tracked in a follow-up issue.
- The path guard (3 × `realpath`, `open`, `fstat`) runs on every range request on purpose
  (owner decision, 2026-10-23, MCDA 450/500): no cache until a slowdown is measured.
