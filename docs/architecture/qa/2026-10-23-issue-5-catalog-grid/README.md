# QA pass — issue #5 catalog grid — 2026-10-23

Real server (`apps/server/dist`, port 3000, fresh database) with TMDB replaced by a local
double (`fake-tmdb.mjs`, reached through `redirect-fetch.mjs`, no real key available);
fixture built by `run-qa.sh`: seven FFmpeg clips in a films library (six known titles incl.
one documentary, one unmatched `Home Video`) and three episodes of _Dark_ in a series
library, artwork as coloured gradient PNGs. Web: `vite` dev server on port 5175 proxying
`/api`. Browser: Playwright (Chromium).

| Step                     | Result                                                                                                                                                                                                 | Evidence                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Home at 1440 px          | hero (best rated with a backdrop: _Pulp Fiction_), rows Top rated, Films, Series, Documentaries, then genre rows; `Home Video` shows the title placeholder; only non-empty type tabs (no _Others_) | `01-home-1440.png`         |
| Films → By genre → Crime | views _By genre / Top rated / A–Z_ appear after the type, genre chips after the view; grid "Films — Crime" with Heat and Pulp Fiction                                                                  | `02-films-crime-1440.png`  |
| Open _Heat_              | modal dialog: backdrop, 1995 · 170 min · ★ 7.9, genres, synopsis, cast; Escape closes it                                                                                                               | `03-detail-heat-1440.png`  |
| 390 px, Series → _Dark_  | layout fits, no horizontal page scroll; dialog lists Season 1 with three episodes                                                                                                                      | `04-series-detail-390.png` |
| Console                  | 0 errors / 0 warnings after the favicon fix (a `favicon.ico` 404 was the only error)                                                                                                                   | —                          |

Round 2 (after the review and SonarQube fixes, same fixture): Films → By genre shows the
genre rows then an _Other titles_ row with the un-enriched `Home Video`; controls are now
`<fieldset>` groups with hidden legends, visually unchanged; console 0 errors / 0 warnings
(`05-films-by-genre-1440-r2.png`). Keyboard and focus return are covered by the Playwright
smoke (Escape, Enter on a poster, close button; 8/8 runs green with `--repeat-each 8`).

Limits: episode titles show the series name because the double's season payload did not
match the client's schema (one server warning, scan unaffected) — a double issue, not a
catalog one. Artwork is synthetic.
