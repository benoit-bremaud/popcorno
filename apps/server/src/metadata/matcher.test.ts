import { describe, expect, it } from 'vitest';
import { CAST_LIMIT, pickMatch, toEpisodeInput, toMetadataInput } from './matcher.js';
import type { TmdbEpisode, TmdbTitleDetails } from './tmdb-client.js';

function makeDetails(overrides: Partial<TmdbTitleDetails> = {}): TmdbTitleDetails {
  return {
    id: 603,
    title: 'The Matrix',
    overview: 'A hacker learns the truth.',
    genres: [
      { id: 28, name: 'Action' },
      { id: 878, name: 'Science Fiction' },
    ],
    date: '1999-03-30',
    runtimeMin: 136,
    vote_average: 8.2,
    vote_count: 25000,
    poster_path: '/matrix.jpg',
    backdrop_path: '/matrix-bd.jpg',
    cast: [
      { name: 'Carrie-Anne Moss', character: 'Trinity', profile_path: '/cam.jpg', order: 1 },
      { name: 'Keanu Reeves', character: 'Neo', profile_path: null, order: 0 },
    ],
    ...overrides,
  };
}

describe('pickMatch', () => {
  const candidates = [
    { id: 1, year: 2017 },
    { id: 2, year: null },
    { id: 3, year: 2019 },
  ];

  it('returns the first candidate when no year was parsed', () => {
    expect(pickMatch(candidates, null)).toEqual({ id: 1, year: 2017 });
  });

  it('returns the first candidate whose year matches exactly', () => {
    expect(pickMatch(candidates, 2019)).toEqual({ id: 3, year: 2019 });
  });

  it('accepts a year within the tolerance and ignores dateless candidates', () => {
    expect(pickMatch(candidates, 2018, 1)).toEqual({ id: 1, year: 2017 });
  });

  it('returns null when no candidate is close enough, or when there is none', () => {
    expect(pickMatch(candidates, 2010)).toBeNull();
    expect(pickMatch([], null)).toBeNull();
  });
});

describe('toMetadataInput', () => {
  it('maps the details, sorts the cast by billing order and keeps the TMDB artwork paths', () => {
    const input = toMetadataInput(makeDetails());

    expect(input).toEqual({
      tmdbId: 603,
      title: 'The Matrix',
      overview: 'A hacker learns the truth.',
      genres: [
        { id: 28, name: 'Action' },
        { id: 878, name: 'Science Fiction' },
      ],
      releaseDate: '1999-03-30',
      runtimeMin: 136,
      voteAverage: 8.2,
      voteCount: 25000,
      cast: [
        { name: 'Keanu Reeves', character: 'Neo', profilePath: null },
        { name: 'Carrie-Anne Moss', character: 'Trinity', profilePath: '/cam.jpg' },
      ],
      posterPath: '/matrix.jpg',
      backdropPath: '/matrix-bd.jpg',
    });
  });

  it(`keeps at most ${CAST_LIMIT} cast members`, () => {
    const cast = Array.from({ length: 15 }, (_, order) => ({
      name: `Actor ${order}`,
      character: '',
      profile_path: null,
      order,
    }));

    expect(toMetadataInput(makeDetails({ cast })).cast).toHaveLength(CAST_LIMIT);
  });

  it('turns blank strings and zero votes into nulls', () => {
    const input = toMetadataInput(
      makeDetails({ overview: '  ', date: '', vote_average: 0, vote_count: 0 }),
    );

    expect(input).toMatchObject({
      overview: null,
      releaseDate: null,
      voteAverage: null,
      voteCount: null,
    });
  });
});

describe('toEpisodeInput', () => {
  const episode: TmdbEpisode = {
    episode_number: 2,
    name: 'Lies',
    overview: 'Jonas returns.',
    still_path: '/still.jpg',
    air_date: '2017-12-01',
    runtime: 45,
    vote_average: 8.4,
    vote_count: 120,
  };

  it('maps an episode, the still going to posterPath and the series id kept', () => {
    expect(toEpisodeInput(episode, { tmdbId: 70523 }, 'Dark')).toEqual({
      tmdbId: 70523,
      title: 'Lies',
      overview: 'Jonas returns.',
      genres: [],
      releaseDate: '2017-12-01',
      runtimeMin: 45,
      voteAverage: 8.4,
      voteCount: 120,
      cast: [],
      posterPath: '/still.jpg',
      backdropPath: null,
    });
  });

  it('falls back to the parsed title when TMDB has no episode name', () => {
    expect(toEpisodeInput({ ...episode, name: '' }, { tmdbId: 1 }, 'Dark').title).toBe('Dark');
  });
});
