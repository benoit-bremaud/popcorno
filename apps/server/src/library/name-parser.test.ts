import { describe, expect, it } from 'vitest';
import { isExtra, parseMediaName } from './name-parser.js';

describe('parseMediaName — films (Plex / Jellyfin conventions)', () => {
  it('reads title and year from the file name', () => {
    expect(parseMediaName('Interstellar (2014).mkv', 'films')).toMatchObject({
      kind: 'film',
      title: 'Interstellar',
      year: 2014,
      providerIds: {},
      edition: null,
      part: null,
    });
  });

  it('keeps a year-like number inside the title', () => {
    expect(parseMediaName('Blade Runner 2049 (2017).mkv', 'films')).toMatchObject({
      title: 'Blade Runner 2049',
      year: 2017,
    });
    expect(parseMediaName('1917 (2019).mkv', 'films')).toMatchObject({ title: '1917', year: 2019 });
  });

  it('falls back to the movie folder when the file has no year', () => {
    expect(parseMediaName('Amélie (2001)/Amélie.mp4', 'films')).toMatchObject({
      title: 'Amélie',
      year: 2001,
    });
  });

  it('reads provider id tags in both Jellyfin and Plex forms', () => {
    expect(parseMediaName('Matrix (1999) [tmdbid-603].mkv', 'films')).toMatchObject({
      title: 'Matrix',
      year: 1999,
      providerIds: { tmdb: '603' },
    });
    expect(
      parseMediaName('Matrix (1999) {imdb-tt0133093}/Matrix (1999).mkv', 'films'),
    ).toMatchObject({
      providerIds: { imdb: 'tt0133093' },
    });
  });

  it('reads editions from the Plex tag or the Jellyfin version suffix', () => {
    expect(parseMediaName('Blade Runner (1982) {edition-Final Cut}.mkv', 'films')).toMatchObject({
      title: 'Blade Runner',
      edition: 'Final Cut',
    });
    expect(parseMediaName("Blade Runner (1982) - Director's Cut.mkv", 'films')).toMatchObject({
      edition: "Director's Cut",
    });
  });

  it('reads multi-part suffixes', () => {
    expect(parseMediaName('Lawrence (1962)-cd1.mkv', 'films')).toMatchObject({ part: 1 });
    expect(parseMediaName('Lawrence (1962) part2.mkv', 'films')).toMatchObject({ part: 2 });
    expect(parseMediaName('Lawrence (1962).disc b.mkv', 'films')).toMatchObject({ part: 2 });
  });

  it('keeps an unknown name as a film with the stem and no year (spec 5a)', () => {
    expect(parseMediaName('Home Video.mp4', 'films')).toMatchObject({
      kind: 'film',
      title: 'Home Video',
      year: null,
    });
  });
});

describe('parseMediaName — series', () => {
  it('reads series, season and episode from the standard pattern', () => {
    expect(
      parseMediaName('Breaking Bad (2008)/Season 01/Breaking Bad S01E02 Cat.mkv', 'series'),
    ).toMatchObject({
      kind: 'episode',
      title: 'Breaking Bad',
      year: 2008,
      season: 1,
      episode: 2,
      episodeEnd: null,
    });
  });

  it('reads episode ranges in the three accepted spellings', () => {
    for (const name of ['S01E02-E03', 'S01E02E03', 's01e02-03']) {
      expect(parseMediaName(`Show/Season 01/Show ${name}.mkv`, 'series')).toMatchObject({
        season: 1,
        episode: 2,
        episodeEnd: 3,
      });
    }
  });

  it('takes the series name from the show folder when the file has none', () => {
    expect(parseMediaName('Breaking Bad/Season 01/S01E02.mkv', 'series')).toMatchObject({
      title: 'Breaking Bad',
      season: 1,
      episode: 2,
    });
    expect(parseMediaName('Dark/Season 02/2x03.mkv', 'series')).toMatchObject({
      title: 'Dark',
      season: 2,
      episode: 3,
    });
  });

  it('reads provider ids from the show folder', () => {
    expect(
      parseMediaName('Dark (2017) [tmdbid-70523]/Season 01/Dark S01E01.mkv', 'series'),
    ).toMatchObject({
      title: 'Dark',
      year: 2017,
      providerIds: { tmdb: '70523' },
    });
  });

  it('maps specials to season 0', () => {
    expect(parseMediaName('Show/Season 00/Show S00E01.mkv', 'series')).toMatchObject({
      season: 0,
      episode: 1,
    });
    expect(parseMediaName('Show/Specials/Some Special.mkv', 'series')).toMatchObject({
      kind: 'episode',
      title: 'Show',
      season: 0,
      episode: null,
    });
  });

  it('returns unknown when no code and no season folder exist', () => {
    expect(parseMediaName('Show/Random clip.mkv', 'series')).toMatchObject({
      kind: 'unknown',
      title: 'Random clip',
    });
  });

  it('uses the stem when nothing else names the episode', () => {
    expect(parseMediaName('S01E02.mkv', 'series')).toMatchObject({ title: 'S01E02', season: 1 });
  });
});

describe('isExtra', () => {
  it('detects extras folders and suffixes', () => {
    expect(isExtra('Matrix (1999)/extras/Making of.mkv')).toBe(true);
    expect(isExtra('Matrix (1999)/Behind The Scenes/clip.mkv')).toBe(true);
    expect(isExtra('Matrix (1999)/Matrix (1999)-trailer.mkv')).toBe(true);
    expect(isExtra('Matrix (1999)/Preview.sample.mkv')).toBe(true);
    expect(isExtra('Matrix (1999)/trailer.mp4')).toBe(true);
  });

  it('keeps regular files', () => {
    expect(isExtra('Matrix (1999)/Matrix (1999).mkv')).toBe(false);
    expect(isExtra('Show/Season 01/Show S01E01.mkv')).toBe(false);
  });
});
