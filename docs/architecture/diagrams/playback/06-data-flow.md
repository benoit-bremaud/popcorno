# Data-flow diagram — playback — what goes where

> **Feature**: MVP v0.1.0
> **Related ADRs**: ADR-0001

## Context

Which data crosses which boundary, with personal data flagged. The only PII in the MVP
is the profile name and the watch history, and neither leaves the server.

## Diagram

```mermaid
flowchart LR
  Files[("Media folders")] -->|"file paths, ffprobe streams"| Server
  Server -->|"title + year (no PII)"| TMDB[("TMDB API")]
  TMDB -->|"synopsis, cast, artwork URLs"| Server
  Server -->|"catalog, artwork"| Web[Web player]
  Web -.->|"PII: profile name, watch position"| Server
  Server -.->|"PII: profile name, watch history"| DB[("SQLite")]
  Server -->|"video bytes / HLS segments"| Web
```

## Notes

- TMDB only ever receives a title and a year, never who is watching.
- Watch history stays in the local SQLite file; no telemetry, no cloud sync.
- Artwork is cached on disk under `data/` so TMDB is not hit on every page load.
