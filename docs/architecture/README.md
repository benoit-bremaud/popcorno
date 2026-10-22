# Architecture — Popcorno

Docs-as-code, organised by zoom level (C4) with UML 2.5 diagrams in Mermaid and MADR
decision records. The conception is the source of truth; code conforms to it.

## Context (C4 level 1)

```mermaid
flowchart LR
  Viewer((Viewer)) -->|"browse, watch (browser)"| Popcorno["Popcorno (server + web player)"]
  Owner((Owner)) -->|"configure libraries, profiles"| Popcorno
  Popcorno -->|"titles, artwork"| TMDB[("TMDB API")]
  Popcorno -->|"read files"| Media[("Media folders")]
```

## Containers (C4 level 2)

| Container         | Technology                   | Responsibility                                          |
| ----------------- | ---------------------------- | ------------------------------------------------------- |
| `apps/web`        | React 19, Vite, hls.js       | Catalog browsing, player, profiles UI                   |
| `apps/server`     | Fastify 5, Drizzle, SQLite   | API, library scan, metadata, playback decisions, FFmpeg |
| `packages/shared` | TypeScript                   | Contracts shared by both                                |
| FFmpeg            | external process             | Probe files, transcode to HLS                           |
| SQLite            | file under `DATABASE_PATH`   | Libraries, media, profiles, watch progress              |

## Layout

```
docs/architecture/
  README.md                 # this overview
  decisions/                # ADRs (MADR) — NNNN-kebab-title.md
  diagrams/<feature>/       # UML per feature: 01-use-case … 06-data-flow
  specs/                    # textual use-case specifications (Cockburn)
  qa/                       # QA pass evidence per issue
```

## Features

| Feature    | Diagrams                                | Status  |
| ---------- | --------------------------------------- | ------- |
| `playback` | [diagrams/playback](diagrams/playback)  | design  |

## Decisions

| ADR                                        | Title                          | Status   |
| ------------------------------------------ | ------------------------------ | -------- |
| [0001](decisions/0001-all-typescript-stack.md) | All-TypeScript pnpm monorepo | accepted |
| [0002](decisions/0002-file-naming-parser.md) | File-naming parser: own regex parser | accepted |

## Specifications and QA

- `specs/<feature>.md` — textual Cockburn use-case specs ([library-scan](specs/library-scan.md)).
- `qa/<date>-issue-<n>-<slug>/` — QA pass outputs kept as merge evidence.
