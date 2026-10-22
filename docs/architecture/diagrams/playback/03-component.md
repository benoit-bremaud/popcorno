# Component diagram — playback — system structure

> **Feature**: MVP v0.1.0
> **Related ADRs**: ADR-0001

## Context

How the system is split and who depends on whom. The dependency rule holds: the domain
(decider, entities) imports nothing from Fastify, Drizzle, FFmpeg or the filesystem.

## Diagram

```mermaid
flowchart LR
  subgraph Web ["apps/web"]
    UI[Catalog + Player screens]
    HLS[hls.js]
    UI --> HLS
  end
  subgraph Shared ["packages/shared"]
    Contracts[API contracts]
  end
  subgraph Server ["apps/server"]
    Routes[HTTP routes]
    subgraph Domain ["domain (pure)"]
      Decider[PlaybackDecider]
      Entities[Media, Library, Profile, WatchProgress]
    end
    Scan[Library scanner]
    Meta[TMDB client]
    Trans[FFmpeg runner]
    Repo[SQLite repositories]
    Routes --> Decider
    Routes --> Repo
    Routes --> Trans
    Routes --> Scan
    Scan --> Meta
    Scan --> Repo
    Decider --> Entities
    Repo --> Entities
  end
  UI --> Contracts
  Routes --> Contracts
  UI -->|"HTTP"| Routes
  Meta -->|"HTTPS"| TMDB[("TMDB")]
  Trans -->|"child process"| FFmpeg[["ffmpeg / ffprobe"]]
  Repo --> DB[("SQLite")]
```

## Notes

- Flat layering on purpose: routes call the domain and the adapters directly. A ports
  layer appears only when a second implementation exists (e.g. a second metadata
  provider).
- `FFmpeg runner` is the single egress to the process API; nothing else spawns processes.
