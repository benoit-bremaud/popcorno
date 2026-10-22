# Popcorno

Self-hosted media server and web player, built from scratch. Takes the best of Jellyfin
(free, self-hosted, no cloud account), Plex (automatic library scan with posters, synopses
and cast) and Netflix (row-based browsing, resume playback, next episode, one profile per
person) — and nothing else.

Popcorno serves **your own media files**. It ships no content source.

## Status

MVP in progress (milestone v0.1.0). Done: library scan (issue #3) — register a media
folder, walk it, parse Plex / Jellyfin file names, probe streams with `ffprobe`, persist
in SQLite. The conception (requirements, UML, ADRs) precedes every brick, per the working
rules in [CLAUDE.md](CLAUDE.md).

## Stack

All-TypeScript pnpm monorepo (ADR-0001):

| Package           | Role                                       |
| ----------------- | ------------------------------------------ |
| `apps/server`     | Fastify API, library scan, FFmpeg control  |
| `apps/web`        | React + Vite web player                    |
| `packages/shared` | Types and contracts shared by both         |

Runtime: Node ≥ 22, pnpm, FFmpeg on the host (or in the Docker image), SQLite via Drizzle.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in TMDB_API_KEY
pnpm dev:server              # http://localhost:3000  (GET /health)
pnpm dev:web                 # http://localhost:5173
```

Quality commands: `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm test` ·
`pnpm coverage` · `pnpm build`.

### Scan a media folder

```bash
curl -X POST localhost:3000/libraries -H 'content-type: application/json' \
  -d '{"name":"Films","rootPath":"/absolute/path/under/MEDIA_ROOT/films","kind":"films"}'
curl -X POST localhost:3000/libraries/<id>/scan     # {added, updated, removed, skipped[]}
curl localhost:3000/libraries/<id>/media            # films / episodes with their streams
```

`ffprobe` (FFmpeg) must be installed. A library root must be `MEDIA_ROOT` or a folder under
it (default `./media`), and the server listens on `127.0.0.1` unless `HOST` says otherwise:
the API has no authentication yet. A scan never prunes rows while a sub-directory is
unreadable or the root is empty (unmounted volume). File names follow the Plex / Jellyfin conventions (`Title (2019).mkv`,
`Show/Season 01/Show S01E02.mkv`, optional `[tmdbid-…]` tags); the full list is in
[docs/architecture/specs/library-scan.md](docs/architecture/specs/library-scan.md).
Database migrations live in `apps/server/drizzle` (`pnpm --filter @popcorno/server exec
drizzle-kit generate` after a schema change) and are applied at server start.

## Documentation

- [docs/requirements](docs/requirements) — vision, actors, functional and non-functional requirements
- [docs/architecture](docs/architecture) — overview, UML diagrams, ADRs
- [PROJECT_LOG.md](PROJECT_LOG.md) — operational logbook
- [CHANGELOG.md](CHANGELOG.md) — released versions
- [SECURITY.md](SECURITY.md) — what is scanned, how to report

## License

[MIT](LICENSE)
