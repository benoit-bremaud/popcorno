import type { Genre, Media, MediaMetadata } from '@popcorno/shared';

export const ACTION: Genre = { id: 28, name: 'Action' };
export const DRAMA: Genre = { id: 18, name: 'Drama' };
export const DOCUMENTARY: Genre = { id: 99, name: 'Documentary' };

/** Test metadata with neutral defaults. */
export function metadata(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    tmdbId: 1,
    overview: 'A synopsis.',
    genres: [],
    releaseDate: null,
    runtimeMin: null,
    voteAverage: null,
    voteCount: null,
    cast: [],
    posterPath: null,
    backdropPath: null,
    fetchedAt: '2026-10-23T00:00:00.000Z',
    ...overrides,
  };
}

/** Test media: a film with no metadata unless overridden. */
export function media(overrides: Partial<Media> & Pick<Media, 'id' | 'title'>): Media {
  return {
    libraryId: 'lib-1',
    kind: 'film',
    year: null,
    relativePath: `${overrides.title}.mkv`,
    durationSec: null,
    season: null,
    episode: null,
    episodeEnd: null,
    seriesId: null,
    providerIds: {},
    edition: null,
    part: null,
    streams: [],
    metadata: null,
    ...overrides,
  };
}
