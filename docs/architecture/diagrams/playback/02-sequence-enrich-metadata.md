# Sequence diagram — playback — refresh metadata from TMDB (UC2)

> **Feature**: UC2 Refresh metadata — [use cases](01-use-case.md),
> [textual spec](../../specs/tmdb-metadata.md)
> **Related ADRs**: ADR-0001, ADR-0003

## Context

One title at a time: resolve a TMDB candidate (id tag, IMDb id or title + year), fetch
the details with the credits, map, cache the artwork, persist; for a series, one season
request per season present in the library. The same flow runs at the end of UC1 when a
key is configured (the «include»); the scanner itself never calls TMDB.

## Diagram

```mermaid
sequenceDiagram
  actor O as Owner
  participant API as Server API
  participant MS as Metadata service
  participant DB as SQLite repository
  participant TC as TMDB client (HTTP egress)
  participant MM as Matcher + mapper (pure)
  participant AC as Artwork cache (data/artwork)

  O->>API: POST /libraries/:id/enrich {refresh?}
  API->>DB: findLibrary(id)
  alt Library missing
    API-->>O: 404 library_not_found
  else No TMDB_API_KEY
    API-->>O: 409 tmdb_not_configured
  else Run already in flight
    API-->>O: 409 enrich_running
  else
    API->>MS: enrich(library, {refresh})
    MS->>DB: countLookedUp(libraryId) → skipped (0 when refresh)
    MS->>DB: listPending(libraryId, refresh) — films, series, unknown; series with a pending episode
    loop Each pending title (sequential)
      alt providerIds.tmdb (whole number)
        MS-->>MS: candidate id = tag
      else providerIds.imdb
        MS->>TC: findByImdb(kind, imdbId)
        TC-->>MS: candidates[]
        MS->>MM: pickMatch(candidates, null)
      else
        MS->>TC: search(kind, title, year)
        TC-->>MS: candidates[]
        MS->>MM: pickMatch(candidates, year)
        opt No candidate with the year
          MS->>TC: search(kind, title, null) — no year
          MS->>MM: pickMatch(candidates, year, tolerance 1)
        end
      end
      alt No candidate
        MS->>DB: markUnmatched(mediaId, fetchedAt) — tmdbId null, columns cleared
      else
        MS->>TC: details(kind, id) — append_to_response=credits
        alt 404 on a tagged id (spec 4b)
          MS->>DB: markUnmatched(mediaId, fetchedAt)
        else Request failed (network, timeout, 5xx, 429 twice, invalid payload)
          MS-->>MS: report failed, log the cause, row untouched
        else
          TC-->>MS: TmdbTitleDetails
          MS->>MM: toMetadataInput(details) → MetadataInput
          MS->>AC: cache(posterPath, w500), cache(backdropPath, w1280)
          opt First image of the client's life
            AC->>TC: image(path, size) → GET /configuration (base URL, cached, pinned to image.tmdb.org)
          end
          AC->>TC: image(path, size) — once per new file, ≤ 10 MB, no redirect
          AC-->>MS: digest file names (or null on failure, logged)
          MS->>DB: saveMetadata(mediaId, input, fetchedAt) — replaces title
          opt Series
            MS->>DB: listEpisodes(seriesRowId) — grouped by season
            loop Each season (sequential)
              MS->>TC: season(tmdbId, n)
              alt Season request failed (spec 8a)
                MS-->>MS: log, episodes keep their fields
              else
                MS->>MM: toEpisodeInput(episode, {tmdbId}, parsedTitle) per episode row
                MS->>AC: cache(stillPath, w500)
                MS->>DB: saveMetadata(episodeId, input, fetchedAt) — or markLookedUp when absent (8b)
              end
            end
          end
        end
      end
    end
    MS-->>API: EnrichReport
    API-->>O: 200 {matched, unmatched[], failed[], skipped}
  end
```

## Notes

- The TMDB client is the single HTTP egress of the server; it receives `fetch` by
  injection so tests assert URLs and headers without a socket. It adds the Bearer header
  and the `language` parameter and retries once on `429` after `Retry-After` (capped at
  10 s). The key only ever travels in the header: a `TmdbRequestError` carries the path
  and the status, nothing else.
- Only `query` (title), `year` / `first_air_date_year` and a provider id ever appear in a
  request (data-flow 06).
- Matcher and mapper are pure: fixtures in, typed values out, no I/O. An episode's
  `tmdbId` is the series id (TMDB episode ids are not stored).
- The client validates the TMDB path before building a URL; the cache names files by the
  SHA-256 of `size + path` (the same path at two sizes gives two files); the serving route
  (`GET /artwork/:file`) accepts digests only.
- Failures are per title: the report lists them, the log keeps the cause, the run
  continues, the scan that included the run still returns `200` (`metadata: null` when
  the include itself could not run).
