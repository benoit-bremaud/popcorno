# Sequence diagram — playback — watch a title (direct play or HLS transcode)

> **Feature**: UC5 Watch a title — [use cases](01-use-case.md)
> **Related ADRs**: ADR-0001

## Context

The one non-trivial flow of the MVP: deciding between direct play and transcode, and
streaming either. Resume (UC6) only changes the initial `startAt`.

## Diagram

```mermaid
sequenceDiagram
  actor V as Viewer
  participant W as Web player
  participant API as Server API
  participant PD as PlaybackDecider
  participant FF as FFmpeg
  participant FS as Media files

  V->>W: Press play on a title
  W->>API: POST /playback/sessions {mediaId, profileId, capabilities}
  API->>PD: decide(media.streams, capabilities)
  alt Browser can read container + codecs
    PD-->>API: DirectPlay
    API-->>W: 201 {mode: direct, url: /media/:id/file}
    W->>API: GET /media/:id/file (Range)
    API->>FS: read range
    FS-->>API: bytes
    API-->>W: 206 Partial Content
  else Needs transcode
    PD-->>API: Transcode(profile)
    API->>FF: spawn ffmpeg -i file … -f hls
    API-->>W: 201 {mode: hls, url: /playback/:session/index.m3u8}
    loop Every few seconds
      W->>API: GET segment-N.ts
      API-->>W: 200 segment
    end
  end
  loop Every 10 s while playing
    W->>API: PUT /profiles/:id/progress {mediaId, positionSec}
    API-->>W: 204
  end
  V->>W: Close the player
  W->>API: DELETE /playback/sessions/:session
  API->>FF: kill
```

## Notes

- `PlaybackDecider` is pure domain code: streams + capabilities in, decision out. It is
  the first unit-test target.
- The Range path never touches FFmpeg; the HLS path never touches Range.
- Session deletion kills the FFmpeg child; a watchdog also kills sessions idle > 60 s.
- Path safety: `/media/:id/file` resolves the id to a path stored at scan time, never a
  client-supplied path.
