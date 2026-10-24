import type { CastMember, Genre } from '@popcorntv/shared';
import type { TmdbCandidate, TmdbEpisode, TmdbTitleDetails } from './tmdb-client.js';

/**
 * Pure matching and mapping of TMDB payloads (ADR-0003 § 2 and § 3): no I/O, every
 * branch a fixture. The service decides which requests to make; this module decides
 * which candidate wins and what gets persisted.
 */

/** Cast members kept per title (billing order). */
export const CAST_LIMIT = 10;

/**
 * The first candidate whose year is within `tolerance` of the parsed `year`; the first
 * candidate when no year was parsed; null when nothing qualifies.
 */
export function pickMatch(
  candidates: readonly TmdbCandidate[],
  year: number | null,
  tolerance = 0,
): TmdbCandidate | null {
  if (year === null) return candidates[0] ?? null;
  return (
    candidates.find(
      (candidate) => candidate.year !== null && Math.abs(candidate.year - year) <= tolerance,
    ) ?? null
  );
}

/** What the repository writes for a title or an episode; artwork paths are still TMDB paths here. */
export interface MetadataInput {
  readonly tmdbId: number;
  readonly title: string;
  readonly overview: string | null;
  readonly genres: readonly Genre[];
  readonly releaseDate: string | null;
  readonly runtimeMin: number | null;
  readonly voteAverage: number | null;
  readonly voteCount: number | null;
  readonly cast: readonly CastMember[];
  readonly posterPath: string | null;
  readonly backdropPath: string | null;
}

function blankToNull(value: string | null): string | null {
  return value && value.trim() !== '' ? value : null;
}

/** Vote averages are meaningless without votes: TMDB returns 0 for both. */
function rating(average: number, count: number): Pick<MetadataInput, 'voteAverage' | 'voteCount'> {
  return count > 0
    ? { voteAverage: average, voteCount: count }
    : { voteAverage: null, voteCount: null };
}

/** Movie or series details → what gets persisted (top `CAST_LIMIT` cast by billing order). */
export function toMetadataInput(details: TmdbTitleDetails): MetadataInput {
  const cast = [...details.cast]
    .sort((a, b) => a.order - b.order)
    .slice(0, CAST_LIMIT)
    .map((member) => ({
      name: member.name,
      character: member.character,
      profilePath: member.profile_path,
    }));
  return {
    tmdbId: details.id,
    title: details.title,
    overview: blankToNull(details.overview),
    genres: details.genres,
    releaseDate: blankToNull(details.date),
    runtimeMin: details.runtimeMin,
    ...rating(details.vote_average, details.vote_count),
    cast,
    posterPath: details.poster_path,
    backdropPath: details.backdrop_path,
  };
}

/**
 * One episode of a season payload → what gets persisted on the episode row. `tmdbId` is
 * the series id (episode ids are not stored); genres and cast belong to the series; the
 * still goes to `posterPath`; the parsed title is kept when TMDB has no name for the episode.
 */
export function toEpisodeInput(
  episode: TmdbEpisode,
  series: { readonly tmdbId: number },
  fallbackTitle: string,
): MetadataInput {
  return {
    tmdbId: series.tmdbId,
    title: blankToNull(episode.name) ?? fallbackTitle,
    overview: blankToNull(episode.overview),
    genres: [],
    releaseDate: blankToNull(episode.air_date),
    runtimeMin: episode.runtime,
    ...rating(episode.vote_average, episode.vote_count),
    cast: [],
    posterPath: episode.still_path,
    backdropPath: null,
  };
}
