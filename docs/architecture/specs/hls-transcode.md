# UC5 (HLS branch) — Watch a title the browser cannot read natively

> **Feature**: Playback — [use cases](../diagrams/playback/01-use-case.md),
> [sequence](../diagrams/playback/02-sequence-watch-a-title.md),
> [state](../diagrams/playback/05-state-playback-session.md)
> **Issue**: #8 · **Related ADRs**: ADR-0001, ADR-0004, ADR-0005, ADR-0006
> Format: Cockburn casual use case.

## 1. Requirements

- **R1** Every scanned film or episode with a video stream gets a **Play** button; the
  note *Not playable in this browser yet* disappears.
- **R2** Pressing Play asks the server for a playback session; the server is the single
  authority on direct vs HLS. It reuses `directPlayMime` (packages/shared) to confirm the
  browser's direct-play answer; anything else is served as HLS.
- **R3** HLS: the server runs one FFmpeg process per session, writing a playlist and
  segments into a private temp directory; only those files are served, by session id.
- **R4** A session is killed (FFmpeg stopped, directory removed) on `DELETE`, after 60 s
  without any request from its player, and on server shutdown.
- **R5** At most `TRANSCODE_MAX_SESSIONS` (default 1) HLS sessions run at once
  (requirements: "transcoding runs one stream at a time").
- **R6** Done when an MKV/HEVC + AC-3 (or similar) file plays through HLS in Chromium and
  Firefox.

## 2. Data rules

### 2.1 Direct vs HLS (server)

`POST /playback/sessions` body `{ mediaId: uuid, directPlay: boolean }`, where
`directPlay` is the browser's `decidePlayback(...).mode === 'direct'` (only the browser
can run `canPlayType`).

- `directPlay && directPlayMime(media) !== null` → `200 { mode: 'direct', url:
  '/media/:id/file', mime }`. No session, no state.
- otherwise → HLS session → `201 { mode: 'hls', sessionId, url:
  '/playback/sessions/:id/index.m3u8' }`.

### 2.2 Remux vs transcode, per stream (ADR-0006 §1)

First video stream and first audio stream only (same rule as direct play).

| Stream | Copied when codec is | Otherwise |
| ------ | -------------------- | --------- |
| video  | `h264`               | `libx264 -preset veryfast -crf 23 -pix_fmt yuv420p`, scaled down to ≤ 1080 lines, keyframe every 6 s |
| audio  | `aac`, `mp3`         | `aac -b:a 160k -ac 2` |

A file without audio maps video only. Subtitles are ignored (#24).

### 2.3 FFmpeg output (ADR-0006 §2)

MPEG-TS segments, 6 s target, `EVENT` playlist growing as FFmpeg writes it
(`#EXT-X-ENDLIST` added at the end): `<dir>/index.m3u8`, `<dir>/segment-00000.ts` …
The media path is the argument of `-i`; the process is spawned without a shell.

## 3. UC5 — Watch a title (HLS)

**Primary actor**: Viewer. **Precondition**: the title was scanned (UC1), its detail
dialog is open (UC4).

Main scenario:

1. The viewer presses **Play**.
2. The web computes `decidePlayback` and posts `{ mediaId, directPlay }`.
3. The server finds the media, decides HLS (2.1), creates a temp directory, spawns
   FFmpeg (2.2, 2.3), waits until `index.m3u8` exists and answers `201`.
4. The web opens the player and attaches hls.js (or the native HLS support of Safari) to
   the playlist URL; playback starts.
5. While the player is open, the web sends `POST /playback/sessions/:id/heartbeat`
   every 20 s; hls.js fetches the playlist and segments.
6. The viewer closes the player; the web sends `DELETE /playback/sessions/:id`; the
   server kills FFmpeg and removes the directory. Focus returns to Play.

Extensions:

- 2a. `directPlay` confirmed (2.1) → `200 mode: direct`; the #7 flow runs unchanged.
- 3a. Unknown media, row without file, or stored path no longer confined → `404
  media_not_found` (same path guard as #7).
- 3b. Media without a video stream → `422 not_playable`; no Play button is shown for it.
- 3c. `TRANSCODE_MAX_SESSIONS` reached → `503 transcode_busy`; the player shows *Another
  title is being transcoded. Try again later.*
- 3d. FFmpeg exits, or no playlist after 20 s → session removed, `502 transcode_failed`;
  the player shows *This file could not be played*.
- 4a. hls.js reports a fatal error → same message as 3d, the session is deleted.
- 5a. No request for 60 s (tab closed, network lost) → the watchdog kills the session.
- 5b. Request on a closed or unknown session → `404 session_not_found`.
- 5c. Segment name not matching `segment-NNNNN.ts` → `404` (no path is built from it).
- 5d. Seeking past the part written so far is not possible yet (EVENT playlist); the
  seek bar grows as FFmpeg advances. Seek-ahead is a follow-up issue.

## 4. Non-functional

- `transcoder.ts` is the only child-process egress of the playback domain; tests inject a
  fake `spawn`. No real FFmpeg in unit tests.
- Temp root `TRANSCODE_DIR` (default `<os tmp>/popcorno-transcode`), emptied at start;
  one `mkdtemp` directory per session; segment names validated before any `join`.
- Playlist served as `application/vnd.apple.mpegurl`, segments as `video/mp2t`, both
  `Cache-Control: no-store`.
- hls.js is loaded with a dynamic `import()` only for HLS sessions: the catalog bundle
  does not grow.
- ADR-0004 tokens and motion; the player opens exactly as in #7.
</content>
</invoke>
