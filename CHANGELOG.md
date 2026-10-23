# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project bootstrap: monorepo skeleton, CI, Docker, conception documents.
- Library scan (#3): `POST /libraries`, `GET /libraries`, `POST /libraries/:id/scan`,
  `GET /libraries/:id/media`; Plex / Jellyfin file-name parsing, `ffprobe` stream probing,
  SQLite persistence via Drizzle migrations. Library roots are confined under
  `MEDIA_ROOT`; the server listens on `127.0.0.1` by default.
- TMDB metadata (#4): scanned titles are enriched with their official title, synopsis,
  genres, release date, runtime, rating, top cast, poster and backdrop (cached under
  `ARTWORK_DIR`, served by `GET /artwork/:file`); episodes get their name, synopsis and
  still. `POST /libraries/:id/enrich { refresh? }` re-runs it on demand; the scan report
  gains a `metadata` section. New env: `TMDB_API_KEY`, `TMDB_LANGUAGE`, `ARTWORK_DIR`.
