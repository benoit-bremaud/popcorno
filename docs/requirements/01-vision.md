# Vision — PopCornTV

## Problem

Watching one's own film and series collection today means either a heavy, opinionated
server (Jellyfin, Plex) or a bare file share with no metadata, no resume, no profiles.
None of them combines a light self-hosted core with the browsing comfort of a streaming
service.

## Product

PopCornTV is a self-hosted media server with a web player. It scans the owner's media
folders, enriches them with metadata, and lets each household member browse and watch
from a browser — on the LAN first, over the internet later.

It serves **the owner's own files only**. No content source, no indexer, no download
feature is ever part of the product.

Other tools on the same server (e.g. Radarr / Sonarr / Lidarr organising folders, Seerr
for requests) may **coexist**: whatever lands in a library folder is picked up by the
next scan. PopCornTV never calls them (owner decision 2026-10-23, MCDA in the #5 chat:
coexistence 450 / read-only integration 380 / full integration 170).

## Borrowed strengths

| From     | Kept                                                                   |
| -------- | ---------------------------------------------------------------------- |
| Jellyfin | Free, self-hosted, no cloud account, data stays on the owner's machine |
| Plex     | Automatic library scan: posters, synopses, cast, episodes              |
| Netflix  | Row-based browsing, resume playback, next episode, one profile each    |

Explicitly left out: plugin systems, DLNA, live TV, mobile native apps (v1), any
third-party content.

## Actors

- **Viewer** — a household member with a profile; browses and watches.
- **Owner** — the viewer who installed the server; also configures libraries and profiles.
- **Metadata provider** (external system) — TMDB.

## MVP scope (v0.1.0)

1. Scan a media folder into a library (films and series, by file naming convention).
2. Fetch metadata and artwork from TMDB.
3. Browse the catalog in a grid with posters.
4. Play a file the browser can read natively (direct play).
5. Transcode on the fly to HLS when it cannot (FFmpeg).
6. Resume where playback stopped.
7. One profile per household member, with its own watch history.

## Non-functional requirements

- **Self-contained**: one container, one SQLite file, FFmpeg bundled. No external database.
- **Private by default**: LAN only until an auth story exists; no telemetry.
- **Light**: a Raspberry Pi 5 class machine serves two simultaneous direct-play streams;
  transcoding is the only CPU-heavy path and runs one stream at a time.
- **Safe file access**: every served path resolves under the configured media root.
- **Quality**: tests ≥ 80 % coverage, SonarQube gate, security CI baseline.
