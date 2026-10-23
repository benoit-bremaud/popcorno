# UC5 (direct branch) — Watch a title the browser reads natively

> **Feature**: Playback — [use cases](../diagrams/playback/01-use-case.md),
> [sequence](../diagrams/playback/02-sequence-direct-play.md)
> **Issue**: #7 · **Related ADRs**: ADR-0001, ADR-0004, ADR-0005
> Format: Cockburn casual use case.

## 1. Requirements

- **R1** A viewer can play a film or an episode from its detail dialog when the browser
  can decode its container and every selected codec natively.
- **R2** The viewer can seek anywhere in the file (HTTP Range, `206 Partial Content`).
- **R3** A file the browser cannot read natively shows *Not playable in this browser yet*
  instead of a Play button; the HLS transcode branch is #8.
- **R4** The server streams only files it scanned: the id resolves to the stored real path,
  re-checked under the library root and `MEDIA_ROOT` (`path-guard`) at every request. No
  client-supplied path ever reaches the file system.
- **R5** Done when an MP4/H.264 + AAC file plays and seeks in Chromium and Firefox.

## 2. Data rules — the direct-play decision

`decidePlayback(media, canPlay)` (pure, `packages/shared`, ADR-0005):

- **Container** comes from the file extension of `relativePath` (the scan does not store
  the ffprobe format): `.mp4` / `.m4v` → `video/mp4`, `.webm` → `video/webm`. Anything
  else (`.mkv`, `.avi`, `.ts`, …) → not direct-playable.
- **Codecs**: the first video stream and the first audio stream (scan order, codec name
  case-insensitive) are mapped to RFC 6381 strings per container (`CODECS` in
  `packages/shared/src/playback.ts`):
  - MP4: `h264` → `avc1.640028`, `hevc` → `hvc1.1.6.L120.90`, `av1` → `av01.0.08M.08`,
    `vp9` → `vp09.00.40.08`, `aac` → `mp4a.40.2`, `mp3` → `mp4a.6B`, `opus`, `flac`;
  - WebM: `vp8`, `vp9`, `av1` → `av01.0.08M.08`, `opus`, `vorbis`.
  A codec missing from its container's table → not direct-playable. A file with no video
  stream → not playable. Profile and bit depth are not probed yet: a 10-bit H.264 file is
  offered and ends in extension 3a.
- **Browser check**: the MIME string `video/mp4; codecs="avc1.640028, mp4a.40.2"` is
  passed to `canPlay` (in the web app: `HTMLVideoElement.canPlayType`); `""` → not
  playable, `"maybe"` / `"probably"` → direct play.
- Series rows have no file and get no Play button; their episodes do (one per episode).

## 3. UC5 — Watch a title (direct play)

**Primary actor**: Viewer. **Precondition**: the title was scanned (UC1) and its detail
dialog is open (UC4).

Main scenario:

1. The system shows a **Play** button in the detail dialog (for an episode: one per
   episode line) because the decision is *direct*.
2. The viewer presses Play.
3. The system opens a full-viewport player on a native `<video controls>` pointing to
   `GET /media/:id/file`, and starts playback.
4. The browser requests byte ranges; the server answers `206` with `Content-Range`,
   `Accept-Ranges: bytes` and the file's MIME type.
5. The viewer seeks, pauses, goes full screen with the native controls.
6. The viewer closes the player (close button or Escape); playback stops, the detail
   dialog is shown again and keeps the focus on Play.

Extensions:

- 1a. Decision *not playable* → no Play button; the muted note *Not playable in this
  browser yet* is shown (R3).
- 3a. The media element raises an `error` (file vanished, decoder refused despite
  `canPlayType`) → the player shows *This file could not be played* with a Close button.
- 4a. Unknown id or a row without file → `404 media_not_found`.
- 4b. Stored path no longer under the library root or `MEDIA_ROOT` (moved root, symlink
  swapped after the scan) or no longer readable → `404 media_not_found` (no detail leaked).
- 4c. No `Range` header → `200` with the whole body (streamed, never buffered).
- 4d. A valid single range past the end (`bytes=999999999-`) → `416` with
  `Content-Range: bytes */<size>`. A malformed or multi-range header is ignored (RFC 9110
  §14.2) → `200` with the whole file; browsers never send multi-range for media.

## 4. Non-functional

- The checked real path is opened once (`O_NOFOLLOW`), sized with `fstat` and streamed from
  that handle (`createReadStream({ start, end })`): constant memory, no swap between check
  and read.
- Design tokens and motion rules of ADR-0004: the player fades in with
  `--duration-overlay` / `--ease-out`; reduced motion keeps the fade only.
- Keyboard: Play reachable by Tab, Escape closes the player, focus returns to Play.
- No new dependency (ADR-0005).
