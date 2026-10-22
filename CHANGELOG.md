# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project bootstrap: monorepo skeleton, CI, Docker, conception documents.
- Library scan (#3): `POST /libraries`, `GET /libraries`, `POST /libraries/:id/scan`,
  `GET /libraries/:id/media`; Plex / Jellyfin file-name parsing, `ffprobe` stream probing,
  SQLite persistence via Drizzle migrations.
