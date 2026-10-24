# ADR-0006 — HLS transcode: per-stream copy, MPEG-TS EVENT playlist, in-memory sessions

- Status: accepted (owner validated the weights, #8 chat, 2026-10-23)
- Date: 2026-10-23
- Deciders: owner
- Related: UC5 ([spec](../specs/hls-transcode.md)), ADR-0001, ADR-0005, issue #8

## Context

#8 plays files the browser cannot decode natively by transcoding them to HLS with
FFmpeg. Six choices are open. Scores 0–5, weights /100, totals /500; scores are
estimates unless marked verified.

## 1. When to remux vs transcode

- **A — Per stream**: copy H.264 video and AAC/MP3 audio, transcode the rest (H.264 +
  AAC). An MKV/H.264/AC-3 only re-encodes audio.
- **B — Always transcode** both streams.
- **C — Always copy** (remux only).

| Criterion                         | Weight | A                                   | B                                 | C                                 |
| --------------------------------- | -----: | ----------------------------------- | --------------------------------- | --------------------------------- |
| Plays everywhere (correctness)    |     35 | 5 — output is always H.264 + AAC    | 5                                 | 1 — HEVC stays HEVC, Firefox fails |
| CPU / start latency (Pi-class)    |     25 | 5 — copy is near-free               | 1 — full encode for every MKV     | 5                                 |
| Quality (no generation loss)      |     15 | 5                                   | 2                                 | 5                                 |
| KISS                              |     15 | 4 — two booleans in the args        | 5                                 | 5                                 |
| Testability                       |     10 | 5 — pure arg builder                | 5                                 | 5                                 |
| **Total / 500**                   |    100 | **485**                             | 335                               | 335                               |

Points: A = 175+125+75+60+50 · B = 175+25+30+75+50 · C = 35+125+75+75+50.
Sensitivity: KISS at 30 (others renormalised) keeps A first. **A.**

## 2. FFmpeg segment layout

- **A — MPEG-TS segments, 6 s, `EVENT` playlist** written live by FFmpeg
  (`-hls_playlist_type event -hls_list_size 0`).
- **B — fMP4 segments** (`-hls_segment_type fmp4`), same EVENT playlist.
- **C — Pre-computed full VOD playlist** (all segment names up front, Jellyfin-style),
  FFmpeg restarted with `-ss` on seek-ahead.

| Criterion                              | Weight | A                                          | B                                     | C                                       |
| -------------------------------------- | -----: | ------------------------------------------ | ------------------------------------- | --------------------------------------- |
| KISS / MVP scope                       |     35 | 5 — FFmpeg owns the playlist               | 4 — extra init segment                | 1 — playlist synthesis + restart logic  |
| Compatibility (hls.js, Safari native)  |     25 | 5 — the historical default everywhere      | 4 — fine on recent engines            | 5                                       |
| Seek UX                                |     20 | 2 — seek only within what is written       | 2                                     | 5                                       |
| Copy-mode robustness (odd timestamps)  |     20 | 4 — TS tolerant                            | 3 — fMP4 stricter on copied streams   | 3                                       |
| **Total / 500**                        |    100 | **430**                                    | 350                                   | 335                                     |

Points: A = 175+125+40+80 · B = 140+100+40+60 · C = 35+125+100+60.
Sensitivity: seek UX at 40 (others renormalised) → A 3.6, C 3.6/5 tie; with C's cost
the MVP keeps **A**; seek-ahead is a follow-up issue.

## 3. Session storage

- **A — In-memory `Map` in a `SessionManager`**; temp root emptied at start.
- **B — SQLite table** `playback_sessions` + in-memory process handles.
- **C — Filesystem only** (session = directory, pid file).

| Criterion                                     | Weight | A                                      | B                                       | C                                 |
| --------------------------------------------- | -----: | -------------------------------------- | --------------------------------------- | --------------------------------- |
| Correctness (state matches process lifetime)  |     35 | 5 — both die with the server           | 3 — rows survive the processes they describe | 3 — stale pids               |
| KISS / YAGNI                                  |     30 | 5                                      | 2 — migration for ephemeral data        | 3                                 |
| Testability                                   |     20 | 5 — fake spawn + fake timers           | 4                                       | 3                                 |
| Future need (multi-instance, audit)           |     15 | 2                                      | 4                                       | 2                                 |
| **Total / 500**                               |    100 | **455**                                | 300                                     | 285                               |

Points: A = 175+150+100+30 · B = 105+60+80+60 · C = 105+90+60+30.
Sensitivity: future need at 40 keeps A first (4.2 vs 3.3). **A.**

## 4. Idle watchdog

- **A — One `setTimeout` per session refreshed by every request + a 20 s web heartbeat**
  while the player is open (a paused player keeps its session).
- **B — Same timer, refreshed by playlist/segment requests only** (no heartbeat).
- **C — One global sweep every 10 s** comparing `lastSeen`, plus heartbeat.

| Criterion                                         | Weight | A                                   | B                                          | C                               |
| ------------------------------------------------- | -----: | ----------------------------------- | ------------------------------------------ | ------------------------------- |
| Correctness (60 s rule, pause survives)           |     40 | 5                                   | 1 — paused > 60 s after ENDLIST = dead player | 4 — up to 70 s              |
| KISS                                              |     25 | 4 — one extra route                 | 5                                          | 3 — interval lifecycle          |
| Testability                                       |     20 | 5 — fake timers                     | 5                                          | 4                               |
| Resource use                                      |     15 | 5                                   | 5                                          | 4                               |
| **Total / 500**                                   |    100 | **470**                             | 340                                        | 370                             |

Points: A = 200+100+100+75 · B = 40+125+100+75 · C = 160+75+80+60. **A.**

## 5. hls.js integration

- **A — `hls.js` dependency, dynamic `import()` only for HLS sessions**; native HLS only
  where MSE is missing (iOS Safari). QA found that Chromium answers `maybe` to
  `canPlayType('application/vnd.apple.mpegurl')` yet fails to demux, so hls.js comes first.
- **B — Static import** in `PlayerDialog`.
- **C — Native HLS only** (no dependency).

| Criterion                              | Weight | A                                  | B                                  | C                                 |
| -------------------------------------- | -----: | ---------------------------------- | ---------------------------------- | --------------------------------- |
| Works in Chromium + Firefox (R6)       |     40 | 5                                  | 5                                  | 1 — only Safari / recent Chrome   |
| Bundle size of the catalog             |     25 | 5 — separate chunk                 | 2 — ~400 kB on first load          | 5                                 |
| KISS                                   |     20 | 4                                  | 5                                  | 5                                 |
| Testability (jsdom)                    |     15 | 4 — mock the module                | 4                                  | 3                                 |
| **Total / 500**                        |    100 | **460**                            | 395                                | 290                               |

Points: A = 200+125+80+60 · B = 200+50+100+60 · C = 40+125+100+45. **A.**

## 6. Who decides direct vs HLS, and the concurrency limit

- **A — Every Play posts `{mediaId, directPlay}`; the server confirms with
  `directPlayMime` (200 direct | 201 hls). `TRANSCODE_MAX_SESSIONS` (default 1) → 503
  `transcode_busy` beyond it.**
- **B — Web posts only when not direct** (keeps #7 session-free); same limit.
- **C — As A, but a new session pre-empts the oldest** instead of 503.

| Criterion                                      | Weight | A                                         | B                                           | C                                          |
| ---------------------------------------------- | -----: | ----------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| Single authority, matches sequence 02 & brief  |     30 | 5                                         | 2 — server never sees direct plays          | 5                                          |
| Correctness / fairness between viewers         |     25 | 5 — nobody's stream is cut                | 5                                           | 2 — one household member kills another     |
| Latency                                        |     15 | 4 — one small round trip                  | 5                                           | 4                                          |
| Path to #9 resume / #10 profiles               |     20 | 5 — session start is the hook             | 3                                           | 5                                          |
| KISS                                           |     10 | 4                                         | 5                                           | 3                                          |
| **Total / 500**                                |    100 | **480**                                   | 360                                         | 400                                        |

Points: A = 150+125+60+100+40 · B = 60+125+75+60+50 · C = 150+50+60+100+30. **A.**

## Decision

1-A, 2-A, 3-A, 4-A, 5-A, 6-A. New server module `apps/server/src/playback/`:
`ffmpeg-args.ts` (pure), `transcoder.ts` (only child-process egress, `spawn` injected),
`session-manager.ts` (Map, timers, temp dirs), `session-routes.ts`. Config:
`FFMPEG_PATH`, `TRANSCODE_DIR`, `TRANSCODE_MAX_SESSIONS`. New error codes
`session_not_found`, `segment_not_found`, `not_playable`, `transcode_busy`,
`transcode_failed`. Web: `hls.js` (exact pinned version); `PlayerDialog` takes the
browser's `directPlay` answer and starts the session itself.

## Consequences

- The player starts its session once per mount and ends it on the dialog's `close`
  event, not in an effect cleanup: StrictMode re-runs effects, and a second POST would race
  the first for the single transcode slot (found in QA).

- Seeking past the transcoded part is impossible until a seek-ahead follow-up (2-C later).
- HEVC 4K is transcoded on CPU and scaled to 1080p: may be slower than real time on weak
  hosts; hardware encoding is a follow-up.
- One extra round trip before direct play.
- Sessions are lost on restart, by design; the temp root is wiped at start.
</content>
</invoke>
