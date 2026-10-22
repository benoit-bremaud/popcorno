# QA pass — issue #3 library scan — 2026-10-22

Server: `node dist/index.js` on port 3101, `DATABASE_PATH` and `MEDIA_ROOT` on a temporary fixture (FFmpeg-generated clips, one corrupt file, one extras folder, one symlink to /etc/hostname). Real `ffprobe 8.0.1`.

## Fixture
```
./films/Blade Runner 2049 (2017).mp4
./films/Broken (2020).mkv
./films/Escape (2021).mkv
./films/extras/Making of.mkv
./films/Interstellar (2014)/Interstellar (2014).mkv
./series/Dark (2017) [tmdbid-70523]/Season 01/Dark S01E01.mkv
./series/Dark (2017) [tmdbid-70523]/Season 01/Dark S01E02-E03.mkv
```

## POST /libraries (films)

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{"name":"Films","rootPath":"/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/films","kind":"films"}'
```
```json
{
  "id": "adc572cd-9b49-497f-8c9d-088995f62bba",
  "name": "Films",
  "rootPath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/films",
  "kind": "films"
}
```

## POST /libraries (series)

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{"name":"Series","rootPath":"/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/series","kind":"series"}'
```
```json
{
  "id": "08c748fa-95f8-4514-86b1-c0b32f3bf182",
  "name": "Series",
  "rootPath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/series",
  "kind": "series"
}
```

## POST /libraries — invalid body (400)

```bash
curl -s -X POST localhost:3101/libraries -H 'content-type: application/json' -d '{"name":"","rootPath":"relative","kind":"music"}'
```
```json
{
  "error": "invalid_request",
  "details": [
    {
      "origin": "string",
      "code": "too_small",
      "minimum": 1,
      "inclusive": true,
      "path": [
        "name"
      ],
      "message": "Too small: expected string to have >=1 characters"
    },
    {
      "code": "custom",
      "path": [
        "rootPath"
      ],
      "message": "rootPath must be absolute"
    },
    {
      "code": "invalid_value",
      "values": [
        "films",
        "series"
      ],
      "path": [
        "kind"
      ],
      "message": "Invalid option: expected one of \"films\"|\"series\""
    }
  ]
}
```

## GET /libraries

```bash
curl -s localhost:3101/libraries
```
```json
[
  {
    "id": "adc572cd-9b49-497f-8c9d-088995f62bba",
    "name": "Films",
    "rootPath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/films",
    "kind": "films"
  },
  {
    "id": "08c748fa-95f8-4514-86b1-c0b32f3bf182",
    "name": "Series",
    "rootPath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/series",
    "kind": "series"
  }
]
```

## POST /libraries/:id/scan (films) — first run

```bash
curl -s -X POST localhost:3101/libraries/adc572cd-9b49-497f-8c9d-088995f62bba/scan
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
      "path": "extras/Making of.mkv",
      "reason": "extra"
    }
  ]
}
```

## POST /libraries/:id/scan (films) — second run, idempotent

```bash
curl -s -X POST localhost:3101/libraries/adc572cd-9b49-497f-8c9d-088995f62bba/scan
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
      "path": "extras/Making of.mkv",
      "reason": "extra"
    }
  ]
}
```

## GET /libraries/:id/media (films)

```bash
curl -s localhost:3101/libraries/adc572cd-9b49-497f-8c9d-088995f62bba/media
```
```json
[
  {
    "id": "52f4d783-3573-4b0b-aa97-b25ed4f3f8e9",
    "libraryId": "adc572cd-9b49-497f-8c9d-088995f62bba",
    "kind": "film",
    "title": "Blade Runner 2049",
    "year": 2017,
    "filePath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/films/Blade Runner 2049 (2017).mp4",
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
    "id": "ec5dd006-452f-45b4-a5cc-425f67500158",
    "libraryId": "adc572cd-9b49-497f-8c9d-088995f62bba",
    "kind": "film",
    "title": "Interstellar",
    "year": 2014,
    "filePath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/films/Interstellar (2014)/Interstellar (2014).mkv",
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
curl -s -X POST localhost:3101/libraries/08c748fa-95f8-4514-86b1-c0b32f3bf182/scan
```
```json
{
  "added": 2,
  "updated": 0,
  "removed": 0,
  "skipped": []
}
```

## GET /libraries/:id/media (series)

```bash
curl -s localhost:3101/libraries/08c748fa-95f8-4514-86b1-c0b32f3bf182/media
```
```json
[
  {
    "id": "6eef33f2-cf7d-4f5a-8a40-5c001ac80deb",
    "libraryId": "08c748fa-95f8-4514-86b1-c0b32f3bf182",
    "kind": "series",
    "title": "Dark",
    "year": 2017,
    "filePath": null,
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
    "id": "0ae3c709-45d6-4318-9d25-03173d897afb",
    "libraryId": "08c748fa-95f8-4514-86b1-c0b32f3bf182",
    "kind": "episode",
    "title": "Dark",
    "year": 2017,
    "filePath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/series/Dark (2017) [tmdbid-70523]/Season 01/Dark S01E01.mkv",
    "durationSec": 2,
    "season": 1,
    "episode": 1,
    "episodeEnd": null,
    "seriesId": "6eef33f2-cf7d-4f5a-8a40-5c001ac80deb",
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
    "id": "5fa14095-35cd-4ec5-b4ea-62819ac67ca9",
    "libraryId": "08c748fa-95f8-4514-86b1-c0b32f3bf182",
    "kind": "episode",
    "title": "Dark",
    "year": 2017,
    "filePath": "/tmp/claude-1000/-home-vev-Documents-02-personal-popcorno--claude-worktrees-3-library-scan-6c4678/3969a0a4-f8dd-4b7d-967a-71908a934cb0/scratchpad/qa/media/series/Dark (2017) [tmdbid-70523]/Season 01/Dark S01E02-E03.mkv",
    "durationSec": 2,
    "season": 1,
    "episode": 2,
    "episodeEnd": 3,
    "seriesId": "6eef33f2-cf7d-4f5a-8a40-5c001ac80deb",
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

## Unknown library (404)

```bash
curl -s -X POST localhost:3101/libraries/00000000-0000-4000-8000-000000000000/scan
```
```json
{
  "error": "library_not_found"
}
```

## Server log — errors
```
0
```
