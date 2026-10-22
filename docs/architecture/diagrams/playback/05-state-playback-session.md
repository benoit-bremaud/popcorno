# State diagram — playback — PlaybackSession lifecycle

> **Feature**: UC5 Watch a title
> **Related ADRs**: ADR-0001

## Context

A server-side playback session exists only for transcoded playback (direct play is
stateless Range serving). Its lifecycle bounds the FFmpeg process.

## Diagram

```mermaid
stateDiagram-v2
  [*] --> Requested: POST /playback/sessions
  Requested --> Direct: decider says direct play
  Requested --> Starting: decider says transcode
  Starting --> Streaming: first segment written
  Starting --> Failed: ffmpeg exits non-zero
  Streaming --> Streaming: segment requested
  Streaming --> Idle: no request for 60 s
  Idle --> Streaming: segment requested
  Idle --> Closed: watchdog timeout
  Streaming --> Closed: DELETE session
  Direct --> [*]
  Failed --> [*]
  Closed --> [*]: ffmpeg killed, cache dir removed
```

## Notes

- `Direct` terminates immediately: the session record is only an audit line.
- `Idle → Closed` is the safety net against players that never send DELETE (tab closed).
