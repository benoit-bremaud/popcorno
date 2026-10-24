# State diagram — playback — PlaybackSession lifecycle

> **Feature**: UC5 Watch a title — [spec](../../specs/hls-transcode.md)
> **Related ADRs**: ADR-0001, ADR-0006

## Context

A server-side session exists only for HLS playback (direct play is stateless Range
serving). It lives in memory in the `SessionManager` and bounds one FFmpeg process and
one temp directory.

## Diagram

```mermaid
stateDiagram-v2
  [*] --> Starting: POST /playback/sessions (HLS, under the limit)
  Starting --> Streaming: index.m3u8 written
  Starting --> Failed: ffmpeg exits or 20 s without playlist
  state Streaming {
    [*] --> Encoding
    Encoding --> Complete: ffmpeg exits 0 (#EXT-X-ENDLIST)
    Encoding --> Crashed: ffmpeg exits non-zero
  }
  Streaming --> Streaming: playlist / segment / heartbeat (idle timer reset)
  Streaming --> Closed: DELETE session
  Streaming --> Closed: 60 s without request (watchdog)
  Streaming --> Closed: server shutdown
  Failed --> [*]: 502 transcode_failed, dir removed
  Closed --> [*]: ffmpeg killed, dir removed
```

## Notes

- Once `Closed`, the id is forgotten: later requests get `404 session_not_found`.
- `Complete` and `Crashed` keep serving what was written; a crash surfaces in the
  player through hls.js when a missing segment is requested.
- The heartbeat (every 20 s from the open player) keeps a paused session alive; a closed
  tab stops it and the watchdog cleans up.
- `Failed` and `Closed` free a slot of `TRANSCODE_MAX_SESSIONS`.
