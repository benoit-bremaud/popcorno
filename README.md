# Popcorno

Self-hosted media server and web player, built from scratch. Takes the best of Jellyfin
(free, self-hosted, no cloud account), Plex (automatic library scan with posters, synopses
and cast) and Netflix (row-based browsing, resume playback, next episode, one profile per
person) — and nothing else.

Popcorno serves **your own media files**. It ships no content source.

## Status

Phase 0 — project bootstrap. No feature is implemented yet; the conception (requirements,
UML, ADRs) comes first, per the working rules in [CLAUDE.md](CLAUDE.md).

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
`pnpm build`.

## Documentation

- [docs/requirements](docs/requirements) — vision, actors, functional and non-functional requirements
- [docs/architecture](docs/architecture) — overview, UML diagrams, ADRs
- [PROJECT_LOG.md](PROJECT_LOG.md) — operational logbook
- [CHANGELOG.md](CHANGELOG.md) — released versions
- [SECURITY.md](SECURITY.md) — what is scanned, how to report

## License

[MIT](LICENSE)
