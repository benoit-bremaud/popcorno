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
    MS->>TC: configuration()
    TC-->>MS: image base URL
    MS->>DB: listPending(libraryId, refresh) — films, series, unknown
    loop Each pending title (sequential)
      alt providerIds.tmdb
        MS-->>MS: candidate id = tag
      else providerIds.imdb
        MS->>TC: findByImdb(imdbId)
      else
        MS->>TC: search(kind, title, year)
        TC-->>MS: results[]
        MS->>MM: pickMatch(results, title, year)
        opt No result with the year
          MS->>TC: search(kind, title) — no year
          MS->>MM: pickMatch(results, title, year ±1)
        end
      end
      alt No candidate
        MS->>DB: markUnmatched(mediaId) — fetchedAt set, tmdbId null
      else
        MS->>TC: details(kind, id) — append_to_response=credits
        alt Request failed (network, 5xx, 429 twice, invalid payload)
          MS-->>MS: report failed, row untouched
        else
          TC-->>MS: payload
          MS->>MM: toMetadata(payload) → MetadataInput
          MS->>AC: cache(posterPath, w500), cache(backdropPath, w1280)
          AC->>TC: image(path, size) — once per new file
          AC-->>MS: digest file names (or null on failure)
          MS->>DB: saveMetadata(mediaId, input, artwork)
          opt Series
            MS->>DB: listEpisodes(seriesId) — grouped by season
            loop Each season
              MS->>TC: season(id, n)
              MS->>MM: toEpisodeMetadata(episode) per episode row
              MS->>AC: cache(stillPath, w500)
              MS->>DB: saveMetadata(episodeId, …)
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
  and the `language` parameter, retries once on `429` after `Retry-After`, and strips the
  key from any error it throws.
- Only `query` (title), `year` / `first_air_date_year` and a provider id ever appear in a
  request (data-flow 06).
- Matcher and mapper are pure: fixtures in, typed values out, no I/O.
- The artwork cache validates the TMDB path before building a URL and names files by the
  SHA-256 of that path; the serving route (`GET /artwork/:file`) accepts digests only.
- Failures are per title: the report lists them, the run continues, the scan that
  included the run still returns `200`.
