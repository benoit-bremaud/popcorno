# Sequence diagram — playback — scan a media folder (UC1)

> **Feature**: UC1 Scan a media folder — [use cases](01-use-case.md),
> [textual spec](../../specs/library-scan.md)
> **Related ADRs**: ADR-0001, ADR-0002

## Context

Filesystem walk, path guard, one `ffprobe` per new or changed file, pure parsing,
persistence. Shows where the boundaries are (fs, process, SQLite) and where the pure
domain sits (parser, path guard).

## Diagram

```mermaid
sequenceDiagram
  actor O as Owner
  participant API as Server API
  participant SC as Library scanner
  participant FS as Filesystem
  participant PG as Path guard (pure)
  participant NP as Name parser (pure)
  participant FP as ffprobe runner
  participant DB as SQLite repository

  O->>API: POST /libraries/:id/scan
  API->>DB: findLibrary(id)
  alt Library missing
    DB-->>API: null
    API-->>O: 404 library_not_found
  else Scan already running
    API-->>O: 409 scan_running
  else
    API->>SC: scan(library)
    SC->>FS: stat + realpath(rootPath)
    alt Root missing or not a directory
      SC-->>API: RootUnreadableError
      API-->>O: 409 root_unreadable
    else
      SC->>FS: walk(root) — supported extensions, unreadable dirs collected
      FS-->>SC: files[], unreadableDirs[]
      loop Each file
        SC->>FS: realpath + stat(file)
        alt Dangling link / stat failure
          FS-->>SC: error → skipped (unreadable)
        else
          SC->>PG: resolveUnderRoot(root, realPath)
          alt Escapes the root
            PG-->>SC: null → skipped (outside_root)
          else Extra (isExtra)
            SC-->>SC: skipped (extra)
          else
            SC-->>SC: seen.add(realPath)
            SC->>DB: findStoredFile(libraryId, realPath)
            alt Same size and mtime
              DB-->>SC: unchanged → no probe
            else New or changed
              SC->>FP: probe(realPath)
              alt ffprobe fails
                FP-->>SC: error → skipped (probe_failed), row kept
              else
                FP-->>SC: {durationSec, streams[]}
                SC->>NP: parseMediaName(relativePath, library.kind)
                NP-->>SC: ParsedName
                opt Episode
                  SC->>DB: findOrCreateSeries(libraryId, title, year)
                end
                SC->>DB: upsertMedia(libraryId, input, streams) — replaces the streams
              end
            end
          end
        end
      end
      opt No unreadable directory and at least one file seen
        SC->>DB: deleteMissing(libraryId, seen) — then orphan series
      end
      SC-->>API: ScanReport
      API-->>O: 200 {added, updated, removed, skipped[]}
    end
  end
```

## Notes

- The name parser and the path guard are pure functions: unit-tested without fs or
  process mocks.
- The `ffprobe runner` is the single process egress (component diagram); the scanner
  receives it as a dependency so tests inject a fake.
- The guard's result (the real path) is what gets probed and stored, so a link swapped
  after the check cannot make the server read outside the root later.
- Probing only new or changed files keeps a re-scan cheap; the check is size + mtime,
  not a content hash (good enough for the owner's own files).
- A file is "seen" as soon as it belongs to the library, before probing: a failed probe
  or an unreadable neighbour never deletes a row (spec 3a, 3b, 5a).
