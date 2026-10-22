# Sequence diagram — playback — scan a media folder (UC1)

> **Feature**: UC1 Scan a media folder — [use cases](01-use-case.md),
> [textual spec](../../specs/library-scan.md)
> **Related ADRs**: ADR-0001, ADR-0002

## Context

Filesystem walk, pure parsing, one `ffprobe` per new file, persistence. Shows where the
boundaries are (fs, process, SQLite) and where the pure domain sits (parser, path guard).

## Diagram

```mermaid
sequenceDiagram
  actor O as Owner
  participant API as Server API
  participant SC as Library scanner
  participant FS as Filesystem
  participant NP as Name parser (pure)
  participant PG as Path guard (pure)
  participant FP as ffprobe runner
  participant DB as SQLite repository

  O->>API: POST /libraries/:id/scan
  API->>DB: findLibrary(id)
  alt Library missing
    DB-->>API: null
    API-->>O: 404 library_not_found
  else Root unreadable
    API-->>O: 409 root_unreadable
  else
    API->>SC: scan(library)
    SC->>FS: walk(rootPath) — supported extensions
    FS-->>SC: file list
    loop Each file
      SC->>PG: resolveUnderRoot(root, file)
      alt Escapes the root
        PG-->>SC: outside_root → skipped
      else
        SC->>DB: findMedia(libraryId, filePath)
        alt Same size and mtime
          DB-->>SC: unchanged → no probe
        else New or changed
          SC->>NP: parse(relativePath, library.kind)
          NP-->>SC: ParsedName
          SC->>FP: probe(file)
          alt ffprobe fails
            FP-->>SC: error → skipped (probe_failed)
          else
            FP-->>SC: {durationSec, streams[]}
            SC->>DB: upsertMedia + replaceStreams
          end
        end
      end
    end
    SC->>DB: deleteMissing(libraryId, seenPaths)
    SC-->>API: ScanReport
    API-->>O: 200 {added, updated, removed, skipped[]}
  end
```

## Notes

- The name parser and the path guard are pure functions: unit-tested without fs or
  process mocks.
- The `ffprobe runner` is the single process egress (component diagram); the scanner
  receives it as a dependency so tests inject a fake.
- Probing only new or changed files keeps a re-scan cheap; the check is size + mtime,
  not a content hash (good enough for the owner's own files).
