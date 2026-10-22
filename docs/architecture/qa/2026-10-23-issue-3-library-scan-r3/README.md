# QA pass — issue #3 library scan — 2026-10-23 (third pass, after the Codex review fixes, commit 983b112)

Server: `node dist/index.js` on port 3101, `HOST` default (loopback), fresh `DATABASE_PATH`, `MEDIA_ROOT` = the fixture folder (`$M` below). Fixture of the first pass (FFmpeg clips, one corrupt file, one symlink to /etc/hostname) with the extras folder moved under , where Plex and Jellyfin expect it (a top-level  is a title folder). Real `ffprobe 8.0.1-3ubuntu2`.

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
    "id": "4c3c7436-a843-4650-9bbd-0db37b00d3b6",
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
    "id": "b79cb221-5f5f-4d79-b4eb-8f17214300df",
    "name": "Series",
    "rootPath": "$M/series",
    "kind": "series"
}
```

## POST /libraries/:id/scan (films) — corrupt file, extras folder, symlink to /etc

```bash
curl -s -X POST localhost:3101/libraries/4c3c7436-a843-4650-9bbd-0db37b00d3b6/scan
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
curl -s -X POST localhost:3101/libraries/4c3c7436-a843-4650-9bbd-0db37b00d3b6/scan
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
curl -s localhost:3101/libraries/4c3c7436-a843-4650-9bbd-0db37b00d3b6/media
```
```json
[
    {
        "id": "e03cacb5-ce51-4f43-86cb-05485fe2fbac",
        "libraryId": "4c3c7436-a843-4650-9bbd-0db37b00d3b6",
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
        "id": "b37110d6-2d75-4230-b684-7b77516ca343",
        "libraryId": "4c3c7436-a843-4650-9bbd-0db37b00d3b6",
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
curl -s -X POST localhost:3101/libraries/b79cb221-5f5f-4d79-b4eb-8f17214300df/scan
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
curl -s localhost:3101/libraries/b79cb221-5f5f-4d79-b4eb-8f17214300df/media
```
```json
[
    {
        "id": "1dfc5e3a-1328-4697-afec-6139c1065b28",
        "libraryId": "b79cb221-5f5f-4d79-b4eb-8f17214300df",
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
        "id": "cb3e75b1-5c4d-42aa-b866-b3658c9474a7",
        "libraryId": "b79cb221-5f5f-4d79-b4eb-8f17214300df",
        "kind": "episode",
        "title": "Dark",
        "year": 2017,
        "relativePath": "Dark (2017) [tmdbid-70523]/Season 01/Dark S01E01.mkv",
        "durationSec": 2,
        "season": 1,
        "episode": 1,
        "episodeEnd": null,
        "seriesId": "1dfc5e3a-1328-4697-afec-6139c1065b28",
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
        "id": "fbab4ae6-a336-45a8-915a-659e85cefa53",
        "libraryId": "b79cb221-5f5f-4d79-b4eb-8f17214300df",
        "kind": "episode",
        "title": "Dark",
        "year": 2017,
        "relativePath": "Dark (2017) [tmdbid-70523]/Season 01/Dark S01E02-E03.mkv",
        "durationSec": 2,
        "season": 1,
        "episode": 2,
        "episodeEnd": 3,
        "seriesId": "1dfc5e3a-1328-4697-afec-6139c1065b28",
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
