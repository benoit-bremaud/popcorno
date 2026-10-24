# UC6 — Resume a title · UC7 — Play the next episode

> **Feature**: Playback — [use cases](../diagrams/playback/01-use-case.md),
> [sequence](../diagrams/playback/02-sequence-resume-a-title.md),
> [class](../diagrams/playback/04-class.md)
> **Issue**: #9 · **Related ADRs**: ADR-0004, ADR-0005, ADR-0006, ADR-0007
> Format: Cockburn casual use case.

## 1. Requirements

- **R1** While a title plays, the web saves its position every 10 s, on pause and when
  the player closes. Positions are stored per profile and media (`WatchProgress`).
- **R2** Until profiles exist (#10), every position belongs to the single profile
  `default` (ADR-0007 §1).
- **R3** A title with a saved, unfinished position offers **Resume from mm:ss** next to
  **Start over** in its detail dialog. An episode's ▶ resumes at its saved position.
- **R4** A title is *finished* when its position is ≥ 90 % of its duration
  (`isFinished`). A finished title starts over and offers no resume.
- **R5** Resume works for direct play and HLS through the same `POST /playback/sessions`.
  HLS cannot seek ahead (EVENT playlist, ADR-0006 §2), so FFmpeg starts at the offset
  (ADR-0007 §2).
- **R6** When an episode is finished or ends, the player offers **Next episode** (the
  next one by season, then episode number). Pressing it plays that episode in the same
  player (ADR-0007 §4).
- **R7** Done when a reload resumes at the saved position (direct and HLS), the next
  episode is offered, and `isFinished` / the progress repository have unit tests.

## 2. Data rules

### 2.1 Storage

Table `watch_progress`: `profile_id` (text, default `'default'`), `media_id` (FK
`media.id`, cascade delete), `position_sec` (integer ≥ 0), `updated_at` (ISO text).
Primary key `(profile_id, media_id)`: one row per profile and title, upserted.

### 2.2 API

- `PUT /media/:id/progress` body `{ positionSec: integer ≥ 0 }` → `204`. The position is
  clamped to the media duration when it is known. `400` on a bad body, `404
  media_not_found` for an unknown media or a `series` row.
- `GET /progress` → `200 WatchProgress[]`, every row of the `default` profile:
  `{ mediaId, positionSec, durationSec, finished, updatedAt }`, newest first.
- `POST /playback/sessions` body gains `startSec?: integer ≥ 0` (default 0). Both
  answers gain `offsetSec`, the media time at which the player's timeline starts:
  - direct → `offsetSec: 0`; the web seeks the `<video>` to `startSec` itself;
  - HLS → FFmpeg gets `-ss startSec` before `-i`; `offsetSec: startSec`.

  The web always reports `offsetSec + video.currentTime` as the position.

### 2.3 Finished

`isFinished({ positionSec, durationSec })` (packages/shared, pure) = `durationSec` known
and `> 0` and `positionSec ≥ 0.9 × durationSec`. Unknown duration → never finished.

### 2.4 Resume offer

Offered when a row exists, is not finished and `positionSec ≥ 10` (a few seconds of
play are not worth a prompt). The label formats the position as `h:mm:ss` or `m:ss`.

## 3. UC6 — Resume a title

**Primary actor**: Viewer. **Precondition**: the title was watched before (UC5) and its
detail dialog is open (UC4).

Main scenario:

1. The detail dialog loads `GET /progress` and shows **Resume from 12:34** and **Start
   over**.
2. The viewer presses **Resume**.
3. The web posts `{ mediaId, directPlay, startSec: 754 }`.
4. The server answers direct (`offsetSec: 0`) or opens an HLS session whose FFmpeg
   starts at 754 s (`offsetSec: 754`).
5. The web seeks to `startSec − offsetSec` once metadata is loaded, then plays.
6. Every 10 s while playing, on pause and on close, the web sends `PUT
   /media/:id/progress` with `offsetSec + currentTime`.
7. The viewer closes the player; the last position is saved (`keepalive`) and the detail
   dialog reloads the progress.

Extensions:

- 2a. **Start over** → `startSec: 0`; the old position is overwritten by the next save.
- 4a. HLS input seeking lands on the keyframe before the offset: the resumed picture may
  start up to one keyframe interval early (a few seconds). Accepted (ADR-0007 §2).
- 4b. `startSec` past the end of the file → FFmpeg writes no segment, `502
  transcode_failed` as in #8. The web never sends it for a finished title (R4).
- 6a. A save fails (network) → ignored; the next one carries the newer position.
- 6b. The title is deleted by a re-scan → its rows go with it (cascade).

## 4. UC7 — Play the next episode

**Precondition**: an episode plays and a later episode of the same series exists.

1. The position crosses 90 % or the video ends.
2. The player shows **Next episode: <title>**.
3. The viewer presses it; the player saves the current position and plays the next
   episode from its own resume point (or 0).

Extensions:

- 1a. Last episode of the series → nothing is offered.
- 3a. The viewer ignores it → nothing happens; no autoplay countdown in the MVP.

## 5. Non-functional

- `watch_progress` lives in SQLite only; the history never leaves the server
  (data-flow 06).
- Saves are idempotent upserts; at most one every 10 s per open player, plus pause/close.
- `ffmpegArgs` stays pure; `-ss` is placed before `-i` (input seeking) and only when
  `startSec > 0`.
- ADR-0004 tokens and motion; no inline style; the Resume / Start over / Next episode
  buttons reuse `.button` and `.chip`.
