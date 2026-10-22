# Use case diagram — playback — MVP goals

> **Feature**: MVP v0.1.0 — [vision](../../../requirements/01-vision.md) § MVP scope
> **Related ADRs**: ADR-0001

## Context

Who wants what from Popcorno in the MVP. Grouped by domain (Library, Browse, Watch,
Profiles), never by the package that implements them. Does not show how the system is
structured — see `03-component.md`.

## Diagram

```mermaid
flowchart LR
  Viewer((Viewer))
  Owner((Owner))
  TMDB(("TMDB (external)"))
  subgraph SYSTEM ["Popcorno"]
    subgraph Library ["Library domain"]
      UC1(("Scan a media folder"))
      UC2(("Refresh metadata"))
    end
    subgraph Browse ["Browse domain"]
      UC3(("Browse the catalog"))
      UC4(("Open a title's details"))
    end
    subgraph Watch ["Watch domain"]
      UC5(("Watch a title"))
      UC6(("Resume a title"))
      UC7(("Play the next episode"))
    end
    subgraph Profiles ["Profiles domain"]
      UC8(("Pick a profile"))
      UC9(("Manage profiles"))
    end
  end
  Owner --> UC1
  Owner --> UC2
  Owner --> UC9
  Viewer --> UC3
  Viewer --> UC4
  Viewer --> UC5
  Viewer --> UC6
  Viewer --> UC7
  Viewer --> UC8
  UC2 -.->|"fetches from"| TMDB
  Owner -.->|"generalises"| Viewer
```

## Notes

- Owner generalises Viewer: the owner also browses and watches; only the owner's own
  goals are linked to Owner.
- UC6 and UC7 «extend» UC5 at the "playback ends / is reopened" extension points; kept as
  separate ovals for readability.
- UC2 is actor-initiated (the owner asks for a refresh); the scan's automatic metadata
  fetch is an «include» of UC1, not a use case of its own.
