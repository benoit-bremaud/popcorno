# ADR-0007 — Resume playback: default profile, HLS start offset, client-driven saves

- Status: accepted (owner validated the weights, #9 chat, 2026-10-24)
- Date: 2026-10-24
- Deciders: owner
- Related: UC6 / UC7 ([spec](../specs/resume-playback.md)), ADR-0005, ADR-0006, issue #9

## Context

#9 saves where a title stopped and resumes there, and offers the next episode. Profiles
(#10) do not exist yet, and HLS sessions cannot seek ahead (ADR-0006 §2). Four choices
are open. Scores 0–5, weights /100, totals /500; scores are estimates.

## 1. Who owns a position before profiles exist

- **A — `profile_id` column, default `'default'`**, primary key `(profile_id,
  media_id)`; #10 adds the `profiles` table and the foreign key.
- **B — No profile column now**; #10 adds it with a migration and backfills.
- **C — Build minimal profiles now** (table + header), ahead of #10.

| Criterion                       | Weight | A                                         | B                                     | C                                   |
| ------------------------------- | -----: | ----------------------------------------- | ------------------------------------- | ----------------------------------- |
| Matches the class diagram       |     30 | 5 — `WatchProgress.profileId` as modelled | 2 — diverges until #10                | 5                                   |
| Scope discipline (one issue)    |     30 | 5                                         | 5                                     | 1 — does #10's work                 |
| Migration cost for #10          |     20 | 4 — add an FK only                        | 2 — rebuild PK + backfill             | 5                                   |
| KISS                            |     20 | 4 — one constant                          | 5                                     | 2                                   |
| **Total / 500**                 |    100 | **470**                                   | 350                                   | 330                                 |

Points: A = 150+150+80+80 · B = 60+150+40+100 · C = 150+30+100+40.
Sensitivity: KISS at 40 (others renormalised) → A 4.6, B 3.9/5. **A.**

## 2. Resuming inside an HLS transcode

- **A — `-ss startSec` before `-i`, `offsetSec` in the answer**: the HLS timeline starts
  at 0 = `startSec`; the web adds `offsetSec` to `currentTime` when it saves.
- **B — `-ss` + `-copyts`** so segment timestamps keep the media time and the seek bar
  shows the real time.
- **C — Seek-ahead first** (full VOD playlist, FFmpeg restarted on seek, ADR-0006 §2 C),
  then resume = an ordinary seek.

| Criterion                                | Weight | A                                         | B                                                 | C                                  |
| ---------------------------------------- | -----: | ----------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Works with hls.js + Safari today         |     35 | 5 — playlist starts at 0, nothing unusual | 2 — EVENT playlist with a large first PTS: hls.js / Safari behaviour unverified | 5 |
| KISS / scope of #9                       |     30 | 5 — one arg pair + one field              | 4                                                 | 1 — a feature of its own           |
| Seek bar shows true time                 |     15 | 2 — starts at 0 after a resume            | 5                                                 | 5                                  |
| Resume accuracy                          |     20 | 4 — keyframe before the offset (seconds)  | 4                                                 | 4                                  |
| **Total / 500**                          |    100 | **440**                                   | 345                                               | 365                                |

Points: A = 175+150+30+80 · B = 70+120+75+80 · C = 175+30+75+80.
Sensitivity: true-time seek bar at 35 (others renormalised) → A 3.8, C 3.9/5, but C is
a separate feature (the seek-ahead follow-up); within #9 **A**, and C later replaces it
without changing the API (`offsetSec` becomes 0).

## 3. Who writes the position

- **A — The web**: `PUT /media/:id/progress` every 10 s while playing, on pause and on
  close (`keepalive`).
- **B — The server infers it** from the HLS segments requested.
- **C — The web, on close only.**

| Criterion                                | Weight | A                                  | B                                        | C                                   |
| ---------------------------------------- | -----: | ---------------------------------- | ---------------------------------------- | ----------------------------------- |
| Covers direct play and HLS               |     35 | 5                                  | 0 — direct play requests no segments     | 5                                   |
| Survives a crash / closed tab            |     25 | 5 — at most 10 s lost              | 4                                        | 1 — `keepalive` on unload is best effort |
| Accuracy (paused, buffered ahead)        |     20 | 5 — the player's own time          | 2 — segments are fetched ahead           | 5                                   |
| KISS / load                              |     20 | 4 — one small request per 10 s     | 3                                        | 5                                   |
| **Total / 500**                          |    100 | **480**                            | 230                                      | 380                                 |

Points: A = 175+125+100+80 · B = 0+100+40+60 · C = 175+25+100+100.
Sensitivity: KISS at 40 (others renormalised) → A 4.6, C 4.0/5. **A** (the issue's own
"PUT progress every 10 s").

## 4. Next episode (UC7)

- **A — A "Next episode" button** in the player once the episode is finished or ended;
  the next episode is computed in the web from the series' season list.
- **B — Autoplay countdown** (Netflix-style, 10 s then plays).
- **C — Defer UC7** to its own issue.

| Criterion                             | Weight | A                                         | B                                         | C                              |
| ------------------------------------- | -----: | ----------------------------------------- | ----------------------------------------- | ------------------------------ |
| Delivers the issue (#9 lists UC7)     |     35 | 5                                         | 5                                         | 0                              |
| KISS / testability                    |     30 | 5 — a pure `nextEpisode` + one button     | 3 — timers, cancel, focus management      | 5                              |
| UX (design direction: Netflix-like)   |     20 | 4                                         | 5                                         | 1                              |
| Accessibility (no surprise autoplay)  |     15 | 5                                         | 3 — needs a visible cancel                | 5                              |
| **Total / 500**                       |    100 | **480**                                   | 410                                       | 270                            |

Points: A = 175+150+80+75 · B = 175+90+100+45 · C = 0+150+20+75.
Sensitivity: UX at 40 (others renormalised) → A 4.7, B 4.4/5. **A**; a countdown can be
added on top later.

## Consequences

- New Drizzle migration `watch_progress`; a `progress` module (repository + routes) in
  `apps/server`; `isFinished` and `nextEpisode` pure in shared / web.
- `POST /playback/sessions` gains `startSec`, its answers `offsetSec` (backwards
  compatible: both default to 0).
- After an HLS resume the seek bar starts at the resume point until seek-ahead lands.
- #10 adds `profiles` and turns `profile_id` into a foreign key; the default profile
  becomes the first real one.
