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
    UI --> Contracts
    HLS[hls.js]
    UI --> HLS
  end
  subgraph Shared ["packages/shared"]
    Contracts[API contracts + decidePlayback]
  end
  subgraph Server ["apps/server"]
    Routes[HTTP routes]
    subgraph Domain ["domain (pure)"]
      Decider[PlaybackDecider]
      Entities[Media, Library, Profile, WatchProgress]
    end
    Scan[Library scanner]
    Parser[Name parser + path guard]
    MetaSvc[Metadata service]
    Match[Matcher + mapper]
    Meta[TMDB client]
    Art[Artwork cache]
    Trans[FFmpeg runner]
    Probe[ffprobe runner]
    Repo[SQLite repositories]
    Stream[Range file streamer]
    Routes --> Stream
    Stream --> Parser
    Routes --> Decider
    Routes --> Repo
    Routes --> Trans
    Routes --> Scan
    Scan --> Parser
    Scan --> Probe
    Scan --> Repo
    Routes --> MetaSvc
    MetaSvc --> Match
    MetaSvc --> Meta
    MetaSvc --> Art
    MetaSvc --> Repo
    Art --> Meta
    Match --> Entities
    Decider --> Entities
    Parser --> Entities
    Repo --> Entities
  end
  UI --> Contracts
  Routes --> Contracts
  UI -->|"HTTP"| Routes
  Meta -->|"HTTPS"| TMDB[("TMDB")]
  Art --> Disk[("data/artwork")]
  Trans -->|"child process"| FFmpeg[["ffmpeg"]]
  Probe -->|"child process"| FFprobe[["ffprobe"]]
  Repo --> DB[("SQLite")]
```

## Notes

- Flat layering on purpose: routes call the domain and the adapters directly. A ports
  layer appears only when a second implementation exists (e.g. a second metadata
  provider).
- The two runners are the only egress to the process API; nothing else spawns processes.
  The scanner receives the `ffprobe runner` as a function (`Prober`) so tests inject a
  fake. `Name parser + path guard` are pure (no fs, no process).
- Metadata (#4, ADR-0003): the `TMDB client` is the single HTTP egress, injected into
  the `Metadata service` as an interface (tests pass a fake; the real one receives
  `fetch`). `Matcher + mapper` are pure. The `Artwork cache` is the only writer under
  `data/artwork` and downloads through the client. The scanner never calls TMDB: the
  scan route composes `scan` then `enrich` (UC1's «include»), so a TMDB failure cannot
  fail a scan.
