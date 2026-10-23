import { DOCUMENTARY_GENRE_ID, isDocumentary } from '@popcorno/shared';
import type { Genre, Media } from '@popcorno/shared';

/** The catalog's type tabs (spec §2), in display order. */
export const CATALOG_TYPES = ['films', 'series', 'documentaries', 'others'] as const;

/** What a catalog item is, for browsing purposes. */
export type CatalogType = (typeof CATALOG_TYPES)[number];

/** Display label of each type. */
export const TYPE_LABELS: Readonly<Record<CatalogType, string>> = {
  films: 'Films',
  series: 'Series',
  documentaries: 'Documentaries',
  others: 'Others',
};

/** A titled shelf of items; `key` is stable across renders. */
export interface Row {
  readonly key: string;
  readonly title: string;
  readonly items: readonly Media[];
}

const TOP_RATED_LIMIT = 20;

/** Top-level items only: episodes live inside their series (spec §2). */
export function catalogItems(media: readonly Media[]): Media[] {
  return media.filter((item) => item.kind !== 'episode');
}

/** Documentaries first (any kind), then the media kind decides. */
export function typeOf(item: Media): CatalogType {
  if (item.metadata !== null && isDocumentary(item.metadata)) return 'documentaries';
  if (item.kind === 'film') return 'films';
  if (item.kind === 'series') return 'series';
  return 'others';
}

/** Items of one type. */
export function ofType(items: readonly Media[], type: CatalogType): Media[] {
  return items.filter((item) => typeOf(item) === type);
}

/** Types that have at least one item, in display order (spec 4a). */
export function availableTypes(items: readonly Media[]): CatalogType[] {
  return CATALOG_TYPES.filter((type) => items.some((item) => typeOf(item) === type));
}

/** A copy sorted by title, locale-aware. */
export function sortByTitle(items: readonly Media[]): Media[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title));
}

function isRated(item: Media): boolean {
  return (item.metadata?.voteAverage ?? null) !== null && (item.metadata?.voteCount ?? 0) > 0;
}

/** Rated items, best first (rating, then votes, then title), at most `limit`. */
export function topRated(items: readonly Media[], limit = TOP_RATED_LIMIT): Media[] {
  return items
    .filter(isRated)
    .sort(
      (a, b) =>
        (b.metadata?.voteAverage ?? 0) - (a.metadata?.voteAverage ?? 0) ||
        (b.metadata?.voteCount ?? 0) - (a.metadata?.voteCount ?? 0) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

/** Genres present among the items (documentary excluded), most populated first. */
export function availableGenres(items: readonly Media[]): Genre[] {
  const counts = new Map<number, { genre: Genre; count: number }>();
  for (const item of items) {
    for (const genre of item.metadata?.genres ?? []) {
      if (genre.id === DOCUMENTARY_GENRE_ID) continue;
      const entry = counts.get(genre.id) ?? { genre, count: 0 };
      counts.set(genre.id, { genre: entry.genre, count: entry.count + 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.genre.name.localeCompare(b.genre.name))
    .map((entry) => entry.genre);
}

/** Items carrying a genre, A–Z. */
export function ofGenre(items: readonly Media[], genreId: number): Media[] {
  return sortByTitle(
    items.filter((item) => item.metadata?.genres.some((genre) => genre.id === genreId) ?? false),
  );
}

/** One row per available genre. */
export function genreRows(items: readonly Media[]): Row[] {
  return availableGenres(items).map((genre) => ({
    key: `genre-${genre.id}`,
    title: genre.name,
    items: ofGenre(items, genre.id),
  }));
}

/** "By genre" view of a type: genre rows, then the titles without any genre yet (not enriched). */
export function byGenreRows(items: readonly Media[]): Row[] {
  const untagged = items.filter((item) => (item.metadata?.genres.length ?? 0) === 0);
  const rows = genreRows(items);
  return untagged.length === 0
    ? rows
    : [...rows, { key: 'no-genre', title: 'Other titles', items: sortByTitle(untagged) }];
}

/** Home view rows (spec UC3 step 3): top rated, one per type, then genres; empty rows dropped. */
export function homeRows(items: readonly Media[]): Row[] {
  const rows: Row[] = [
    { key: 'top-rated', title: 'Top rated', items: topRated(items) },
    ...CATALOG_TYPES.map((type) => ({
      key: `type-${type}`,
      title: TYPE_LABELS[type],
      items: sortByTitle(ofType(items, type)),
    })),
    ...genreRows(items),
  ];
  return rows.filter((row) => row.items.length > 0);
}

/** The hero banner's item: the best-rated item with a backdrop, else the first with one. */
export function heroItem(items: readonly Media[]): Media | null {
  const withBackdrop = items.filter((item) => item.metadata?.backdropPath);
  return topRated(withBackdrop, 1)[0] ?? withBackdrop[0] ?? null;
}

/** A season and its episodes, in order. */
export interface Season {
  readonly season: number | null;
  readonly episodes: readonly Media[];
}

/** Episodes of a series grouped by season, seasons and episodes ascending. */
export function seasonsOf(series: Media, media: readonly Media[]): Season[] {
  const episodes = media
    .filter((item) => item.kind === 'episode' && item.seriesId === series.id)
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  const seasons = new Map<number | null, Media[]>();
  for (const episode of episodes) {
    seasons.set(episode.season, [...(seasons.get(episode.season) ?? []), episode]);
  }
  return [...seasons.entries()].map(([season, list]) => ({ season, episodes: list }));
}
