# Class diagram — playback — domain entities

> **Feature**: MVP v0.1.0
> **Related ADRs**: ADR-0001

## Context

The domain model shared by scan, browse and watch. Persistence shape (tables) derives
from it, not the reverse.

## Diagram

```mermaid
classDiagram
  class Library {
    +string id
    +string name
    +string rootPath
    +LibraryKind kind
  }
  class Media {
    +string id
    +string libraryId
    +MediaKind kind
    +string title
    +int year
    +string filePath
    +int durationSec
    +StreamInfo[] streams
  }
  class Episode {
    +int season
    +int number
    +string seriesId
  }
  class StreamInfo {
    +StreamType type
    +string codec
    +int width
    +int height
    +string language
  }
  class Profile {
    +string id
    +string name
    +string avatar
  }
  class WatchProgress {
    +string profileId
    +string mediaId
    +int positionSec
    +Date updatedAt
    +isFinished() bool
  }
  class PlaybackDecider {
    +decide(streams, capabilities) PlaybackDecision
  }
  Library "1" o-- "*" Media
  Media <|-- Episode
  Media "1" *-- "*" StreamInfo
  Profile "1" o-- "*" WatchProgress
  Media "1" o-- "*" WatchProgress
  PlaybackDecider ..> StreamInfo
```

## Notes

- `Episode` extends `Media` with its position in a series; a series is a `Media` of kind
  `series` with no file of its own.
- `WatchProgress.isFinished()` = position ≥ 90 % of duration; drives "next episode".
- `PlaybackDecider` has no state; it is a function in a class box for UML readability.
