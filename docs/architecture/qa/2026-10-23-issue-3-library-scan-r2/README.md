# QA pass — issue #3 library scan — 2026-10-23 (second pass, commit f5788f3)

Server: `node dist/index.js` on port 3101, `HOST` default (loopback), fresh `DATABASE_PATH`, `MEDIA_ROOT` = the fixture folder (`$M` below). Fixture of the first pass (FFmpeg clips, one corrupt file, one symlink to /etc/hostname) with the extras folder moved under `Interstellar (2014)/extras/`, where Plex and Jellyfin expect it (a top-level `extras/` is a title folder). Real `ffprobe 8.0.1-3ubuntu2`.

## GET /health

```bash
curl -s localhost:3101/health
```
```json
{
    "status": "ok",
    "version": "0.0.0"
}
```

## POST /libraries — root outside MEDIA_ROOT → 400

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{"name":"Etc","rootPath":"/etc","kind":"films"}'
```
```json
{
    "error": "invalid_request",
    "details": [
        {
            "path": [
                "rootPath"
            ],
            "message": "rootPath must be under MEDIA_ROOT"
        }
    ]
}
```

## POST /libraries (films)

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{"name":"Films","rootPath":"$M/films","kind":"films"}'
```
```json
{
    "id": "6f2d53df-3f4b-4201-b4ea-78ef7934f45b",
    "name": "Films",
    "rootPath": "$M/films",
    "kind": "films"
}
```

## POST /libraries (series)

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{"name":"Series","rootPath":"$M/series","kind":"series"}'
```
```json
{
    "id": "b8a0a7a0-2f7e-44c7-bf8b-ac4ac863438c",
    "name": "Series",
    "rootPath": "$M/series",
    "kind": "series"
}
```

## POST /libraries/:id/scan (films) — corrupt file, extras folder, symlink to /etc

```bash
curl -s -X POST localhost:3101/libraries/6f2d53df-3f4b-4201-b4ea-78ef7934f45b/scan
```
```json
{
    "added": 2,
    "updated": 0,
    "removed": 0,
    "skipped": [
        {
            "path": "Broken (2020).mkv",
            "reason": "probe_failed"
        },
        {
            "path": "Escape (2021).mkv",
            "reason": "outside_root"
        },
        {
            "path": "Interstellar (2014)/extras/Making of.mkv",
            "reason": "extra"
        }
    ]
}
```

## POST /libraries/:id/scan (films) again — idempotent, nothing pruned

```bash
curl -s -X POST localhost:3101/libraries/6f2d53df-3f4b-4201-b4ea-78ef7934f45b/scan
```
```json
{
    "added": 0,
    "updated": 0,
    "removed": 0,
    "skipped": [
        {
            "path": "Broken (2020).mkv",
            "reason": "probe_failed"
        },
        {
            "path": "Escape (2021).mkv",
            "reason": "outside_root"
        },
        {
            "path": "Interstellar (2014)/extras/Making of.mkv",
            "reason": "extra"
        }
    ]
}
```

## GET /libraries/:id/media (films) — relative paths only

```bash
curl -s localhost:3101/libraries/6f2d53df-3f4b-4201-b4ea-78ef7934f45b/media
```
```json
[
    {
        "id": "c40d0202-d500-4ab6-95b8-68d9893bc4dd",
        "libraryId": "6f2d53df-3f4b-4201-b4ea-78ef7934f45b",
        "kind": "film",
        "title": "Blade Runner 2049",
        "year": 2017,
        "relativePath": "Blade Runner 2049 (2017).mp4",
        "durationSec": 2,
        "season": null,
        "episode": null,
        "episodeEnd": null,
        "seriesId": null,
        "providerIds": {},
        "edition": null,
        "part": null,
        "streams": [
            {
                "type": "video",
                "codec": "h264",
                "width": 320,
                "height": 240,
                "language": null
            },
            {
                "type": "audio",
                "codec": "aac",
                "width": null,
                "height": null,
                "language": "fre"
            }
        ]
    },
    {
        "id": "872bc03a-88cc-4d3a-a23a-e7d17d0705b9",
        "libraryId": "6f2d53df-3f4b-4201-b4ea-78ef7934f45b",
        "kind": "film",
        "title": "Interstellar",
        "year": 2014,
        "relativePath": "Interstellar (2014)/Interstellar (2014).mkv",
        "durationSec": 2,
        "season": null,
        "episode": null,
        "episodeEnd": null,
        "seriesId": null,
        "providerIds": {},
        "edition": null,
        "part": null,
        "streams": [
            {
                "type": "video",
                "codec": "h264",
                "width": 320,
                "height": 240,
                "language": null
            },
            {
                "type": "audio",
                "codec": "aac",
                "width": null,
                "height": null,
                "language": "fre"
            }
        ]
    }
]
```

## POST /libraries/:id/scan (series)

```bash
curl -s -X POST localhost:3101/libraries/b8a0a7a0-2f7e-44c7-bf8b-ac4ac863438c/scan
```
```json
{
    "added": 2,
    "updated": 0,
    "removed": 0,
    "skipped": []
}
```

## GET /libraries/:id/media (series) — series row + episode range, provider id

```bash
curl -s localhost:3101/libraries/b8a0a7a0-2f7e-44c7-bf8b-ac4ac863438c/media
```
```json
[
    {
        "id": "736e23d3-d9cf-4af2-b87b-067fc3db098b",
        "libraryId": "b8a0a7a0-2f7e-44c7-bf8b-ac4ac863438c",
        "kind": "series",
        "title": "Dark",
        "year": 2017,
        "relativePath": null,
        "durationSec": null,
        "season": null,
        "episode": null,
        "episodeEnd": null,
        "seriesId": null,
        "providerIds": {
            "tmdb": "70523"
        },
        "edition": null,
        "part": null,
        "streams": []
    },
    {
        "id": "3fd5b8a6-65c3-43b5-903f-e8eeb5861ed1",
        "libraryId": "b8a0a7a0-2f7e-44c7-bf8b-ac4ac863438c",
        "kind": "episode",
        "title": "Dark",
        "year": 2017,
        "relativePath": "Dark (2017) [tmdbid-70523]/Season 01/Dark S01E01.mkv",
        "durationSec": 2,
        "season": 1,
        "episode": 1,
        "episodeEnd": null,
        "seriesId": "736e23d3-d9cf-4af2-b87b-067fc3db098b",
        "providerIds": {
            "tmdb": "70523"
        },
        "edition": null,
        "part": null,
        "streams": [
            {
                "type": "video",
                "codec": "h264",
                "width": 320,
                "height": 240,
                "language": null
            },
            {
                "type": "audio",
                "codec": "aac",
                "width": null,
                "height": null,
                "language": "fre"
            }
        ]
    },
    {
        "id": "18d230ed-ebf9-4244-9d26-4fc61edf05f3",
        "libraryId": "b8a0a7a0-2f7e-44c7-bf8b-ac4ac863438c",
        "kind": "episode",
        "title": "Dark",
        "year": 2017,
        "relativePath": "Dark (2017) [tmdbid-70523]/Season 01/Dark S01E02-E03.mkv",
        "durationSec": 2,
        "season": 1,
        "episode": 2,
        "episodeEnd": 3,
        "seriesId": "736e23d3-d9cf-4af2-b87b-067fc3db098b",
        "providerIds": {
            "tmdb": "70523"
        },
        "edition": null,
        "part": null,
        "streams": [
            {
                "type": "video",
                "codec": "h264",
                "width": 320,
                "height": 240,
                "language": null
            },
            {
                "type": "audio",
                "codec": "aac",
                "width": null,
                "height": null,
                "language": "fre"
            }
        ]
    }
]
```

## POST /libraries/:id/scan — unknown id → 404

```bash
curl -s -X POST localhost:3101/libraries/00000000-0000-4000-8000-000000000000/scan
```
```json
{
    "error": "library_not_found"
}
```

## GET /libraries/:id/media — malformed id → 400

```bash
curl -s localhost:3101/libraries/nope/media
```
```json
{
    "error": "invalid_request",
    "details": [
        {
            "path": [
                "id"
            ],
            "message": "Invalid UUID"
        }
    ]
}
```

## POST /libraries — malformed JSON → 400 (generic handler)

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{nope'
```
```json
{
    "error": "invalid_request"
}
```

## Server log

Error-level lines: 0. Listening address from the log: Server listening at http://127.0.0.1:3101
