# Sequence diagram — playback — resume a title and play the next episode

> **Feature**: UC6 Resume a title, UC7 Play the next episode —
> [use cases](01-use-case.md), [spec](../../specs/resume-playback.md)
> **Related ADRs**: ADR-0006, ADR-0007

## Context

Resume adds a start offset to the UC5 flow ([sequence](02-sequence-watch-a-title.md))
and a periodic position save. Only the differences are drawn; the session lifecycle is
unchanged.

## Diagram

```mermaid
sequenceDiagram
  actor V as Viewer
  participant D as Detail dialog
  participant P as Web player
  participant API as Routes
  participant PR as Progress repository
  participant SM as SessionManager

  V->>D: Open a title (UC4)
  D->>API: GET /progress
  API->>PR: list() (profile = default)
  API-->>D: 200 WatchProgress[]
  alt saved, unfinished, ≥ 10 s
    D-->>V: Resume from mm:ss · Start over
  else none or finished
    D-->>V: Play
  end
  V->>D: Resume (startSec) or Start over (0)
  D->>P: open(item, startSec)
  P->>API: POST /playback/sessions {mediaId, directPlay, startSec}
  alt direct
    API-->>P: 200 {mode: direct, url, mime, offsetSec: 0}
  else HLS
    API->>SM: open(path, streams, startSec)
    SM->>SM: ffmpeg -ss startSec -i path …
    API-->>P: 201 {mode: hls, sessionId, url, offsetSec: startSec}
  end
  P->>P: on loadedmetadata, currentTime = startSec − offsetSec
  loop every 10 s while playing, on pause, on close (keepalive)
    P->>API: PUT /media/:id/progress {positionSec: offsetSec + currentTime}
    API->>PR: save(mediaId, clamp(position, duration))
    API-->>P: 204
  end
  opt episode finished (≥ 90 %) or ended, and a next episode exists
    P-->>V: Next episode: title
    V->>P: Next episode
    P->>API: PUT progress (current)
    P->>P: replay with the next episode and its own resume point (UC5)
  end
  V->>P: Close
  P->>D: closed(last save settled)
  D->>API: GET /progress (refresh the offer)
```

## Notes

- `offsetSec` makes the saved position absolute whatever the mode: direct play seeks in
  the file, HLS starts FFmpeg at the offset (EVENT playlist, no seek-ahead — ADR-0006).
- HLS input seeking lands on the previous keyframe: the resume may start a few seconds
  early (spec 4a).
- `nextEpisode` and `isFinished` are pure; no autoplay countdown (ADR-0007 §4).
