# UC3 / UC4 — Browse the catalog and open a title

> **Feature**: Catalog — [use cases](../diagrams/catalog/01-use-case.md)
> **Issue**: #5 · **Related ADRs**: ADR-0001, ADR-0003, ADR-0004
> Format: Cockburn casual use cases, preceded by the competitor benchmark the owner asked
> for on 2026-10-23.

## 1. Competitor benchmark

How the five references let a viewer browse a catalog (public product behaviour,
observed on their web clients). "Keep" marks what Popcorno adopts.

| Idea                                    | Plex | Jellyfin | Netflix | Disney+ | Prime | Keep | Why                                                                 |
| --------------------------------------- | :--: | :------: | :-----: | :-----: | :---: | :--: | ------------------------------------------------------------------- |
| Horizontal rows of posters ("shelves")  |  ✔   |    ✔     |    ✔    |    ✔    |   ✔   |  ✔   | Universal, scannable, works with a few or a few hundred titles      |
| Rows by genre                           |  ✔   |    ✔     |    ✔    |    ✔    |   ✔   |  ✔   | Owner request; TMDB genres are stored (#4)                          |
| "Top rated" row                         |  ✔   |    —     |   (Top 10) |  —   |   ✔   |  ✔   | Owner request; TMDB `voteAverage` is stored                         |
| Type switch (films / series / docs)     |  ✔ (libraries) | ✔ (libraries) | ✔ (top nav) | ✔ (brand tiles) | ✔ (top nav) | ✔ | One tab bar instead of one page per library                |
| Hero banner with backdrop               |  ✔   |    —     |    ✔    |    ✔    |   ✔   |  ✔   | Cinema feel at almost no cost: backdrops are cached (#4)            |
| Detail panel over the grid (no reload)  |  —   |    —     |    ✔    |    —    |   —   |  ✔   | Netflix's modal keeps the browsing position                         |
| Grid view with sort (A–Z, rating, year) |  ✔   |    ✔     |    —    |    —    |   —   |  ✔   | Plex/Jellyfin strength for "I know what I want"                     |
| Filter options that depend on the type  |  ✔   |    ✔     |    ✔ (genre menu per tab) | — | ✔ | ✔ | Owner request: progressive disclosure, never a dead option       |
| Autoplay trailers / previews on hover   |  —   |    —     |    ✔    |    ✔    |   ✔   |  ✗   | No trailers in a self-hosted library; distracting                   |
| Personalised "because you watched"      |  —   |    —     |    ✔    |    ✔    |   ✔   |  ✗   | Needs watch history (#9) and profiles (#10) — later brick           |
| Ads / store upsell rows                 |  ✔   |    —     |    —    |    —    |   ✔   |  ✗   | Out of the vision                                                   |
| Continue watching row                   |  ✔   |    ✔     |    ✔    |    ✔    |   ✔   |  later | Depends on #9 resume                                               |

## 2. Data rules

- **Catalog items** are the top-level rows of a library: `film`, `series` and `unknown`.
  Episodes appear only inside their series' detail panel.
- **Type** of an item (`CatalogType`): `documentaries` when its metadata carries TMDB
  genre 99 (any kind), else `films` for `film`, `series` for `series`, else `others`
  (`unknown`, i.e. a file whose name matched no convention).
- **Top rated**: items with a `voteAverage` and at least 1 vote, sorted by `voteAverage`
  desc, then `voteCount` desc, then title; at most 20.
- **Genre rows**: one row per genre present in the current selection, ordered by the
  number of items desc then name; items within a row sorted A–Z. Genre 99 never gets a
  genre row (it already is a type).
- **Artwork**: `posterPath` / `backdropPath` are served by `GET /artwork/:file`; an item
  without a poster shows a token-styled placeholder with its title.

## 3. UC3 — Browse the catalog

**Primary actor**: Viewer. **Precondition**: at least one library was scanned (UC1).

Main scenario:

1. The viewer opens the web player.
2. The system lists the libraries (`GET /libraries`) and the items of every library
   (`GET /libraries/:id/media`), merged into one catalog.
3. The system shows the **home view**: a hero banner (best-rated item with a backdrop),
   then the rows *Top rated*, *Films*, *Series*, *Documentaries*, *Others* (non-empty only),
   then the genre rows.
4. The viewer picks a **type** tab (Films, Series, Documentaries, Others).
5. The system offers the views that make sense for that type — *By genre* (default),
   *Top rated*, *A–Z* — and shows the rows or the grid.
6. In *By genre*, the system offers the genre chips present in that type only; picking a
   chip shows that genre as a full grid; picking it again returns to the rows.

Extensions:

- 2a. A request fails → an error state with a *Retry* button; nothing else is shown.
- 2b. No library or no item → an empty state pointing to the scan (UC1).
- 4a. A type with no item is not offered (its tab is hidden).
- 5a. *Top rated* is not offered when no item of the type has a rating.

## 4. UC4 — Open a title

1. The viewer activates a poster (click, Enter or Space).
2. The system opens a detail dialog over the catalog: backdrop, title, year, runtime,
   rating, genres, synopsis, main cast; for a series, its episodes grouped by season.
3. The viewer closes it (close button or Escape); focus returns to the
   poster. A titles-without-genre row ("Other titles") keeps un-enriched titles reachable in
   the *By genre* view.

Play is #7 ([direct-play spec](direct-play.md)).

## 5. Non-functional

- Design tokens only (ADR-0004); dark theme; responsive from 360 px; keyboard reachable,
  visible focus, `prefers-reduced-motion` respected.
- No new server endpoint: the two existing reads suffice for an MVP library (hundreds of
  items). A paginated `GET /media` is deferred until a library makes it necessary (YAGNI).
- The web player never calls TMDB (data-flow 06): artwork comes from the server cache.
