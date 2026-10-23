# Sequence diagram — playback — direct play (#7)

> **Feature**: UC5 Watch a title, direct branch — [spec](../../specs/direct-play.md)
> **Related ADRs**: ADR-0001, ADR-0005

## Context

Refines the *direct* branch of [watch a title](02-sequence-watch-a-title.md) for #7. Per
ADR-0005 the decision runs in the browser (it is the only place that knows its own
decoders); no playback session exists for direct play. #8 adds the session for HLS.

## Diagram

```mermaid
sequenceDiagram
  actor V as Viewer
  participant D as DetailDialog
  participant PD as decidePlayback (shared)
  participant P as Player (video)
  participant API as GET /media/:id/file
  participant G as path-guard
  participant FS as Media files

  D->>PD: decidePlayback(media, video.canPlayType)
  alt direct
    PD-->>D: {mode: direct, mime}
    D-->>V: Play button
    V->>D: Press Play
    D->>P: open(media)
    P->>API: GET (Range: bytes=0-)
    API->>API: load row (filePath, library root)
    API->>G: realpath + resolveUnderRoot(root), (MEDIA_ROOT)
    alt confined and readable
      G-->>API: path
      API->>FS: createReadStream(start, end)
      FS-->>API: bytes
      API-->>P: 206 Content-Range, Accept-Ranges
      loop Seek
        P->>API: GET (Range: bytes=N-)
        API-->>P: 206
      end
    else escaped, missing or unknown id
      API-->>P: 404 media_not_found
      P-->>V: "This file could not be played"
    end
    V->>P: Close (button / Escape)
    P-->>D: focus back on Play
  else unsupported
    PD-->>D: {mode: unsupported}
    D-->>V: "Not playable in this browser yet" (#8)
  end
```

## Notes

- The id is a UUID validated by zod; it resolves to `media.file_path` (written by the scan).
- The guard is re-run per request: a root moved or a symlink swapped after the scan is
  caught (spec 4b).
