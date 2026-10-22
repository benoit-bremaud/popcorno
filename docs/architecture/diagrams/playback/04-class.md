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
    +string relativePath
    +int durationSec
    +ProviderIds providerIds
    +string edition
    +int part
    +StreamInfo[] streams
  }
  class Episode {
    +int season
    +int episode
    +int episodeEnd
    +string seriesId
  }
  class ProviderIds {
    +string tmdb
    +string imdb
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
  Media "1" *-- "1" ProviderIds
  Profile "1" o-- "*" WatchProgress
  Media "1" o-- "*" WatchProgress
  PlaybackDecider ..> StreamInfo
```

## Notes

- `Episode` extends `Media` with its position in a series (`episodeEnd` for a
  multi-episode file); a series is a `Media` of kind `series` with no file of its own.
- `relativePath` is what the API exposes; the real absolute path, the size and the
  mtime live only in the `media` table (playback and re-scan fingerprint).
- `providerIds`, `edition` and `part` come from the Plex / Jellyfin file-name tags
  (spec UC1); `providerIds` is the hand-off to TMDB (UC2).
- `WatchProgress.isFinished()` = position ≥ 90 % of duration; drives "next episode".
- `PlaybackDecider` has no state; it is a function in a class box for UML readability.
