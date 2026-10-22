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

  it('only accepts a plausible year in parentheses', () => {
    expect(parseMediaName('Film (1080).mkv', 'films')).toMatchObject({
      title: 'Film (1080)',
      year: null,
    });
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

  it('does not take a resolution label or the folder suffix as an edition', () => {
    expect(parseMediaName('Heat (1995) - 1080p.mkv', 'films')).toMatchObject({ edition: null });
    expect(parseMediaName('Heat (1995) - 4K.mkv', 'films')).toMatchObject({ edition: null });
    expect(parseMediaName('Heat (1995) - Remastered/Heat.mkv', 'films')).toMatchObject({
      title: 'Heat',
      year: 1995,
      edition: null,
    });
  });

  it.each([
    ['Lawrence (1962)-cd1.mkv', 1],
    ['Lawrence (1962) part2.mkv', 2],
    ['Lawrence (1962).disc b.mkv', 2],
  ])('reads the multi-part suffix of %s', (name, part) => {
    expect(parseMediaName(name, 'films')).toMatchObject({ part });
  });

  it('needs a separator before a part keyword', () => {
    expect(parseMediaName('Concept2 (2020).mkv', 'films')).toMatchObject({
      title: 'Concept2',
      year: 2020,
      part: null,
    });
    expect(parseMediaName('Concept2.mkv', 'films')).toMatchObject({
      title: 'Concept2',
      part: null,
    });
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

  it.each(['S01E02-E03', 'S01E02E03', 's01e02-03'])('reads the episode range %s', (code) => {
    expect(parseMediaName(`Show/Season 01/Show ${code}.mkv`, 'series')).toMatchObject({
      season: 1,
      episode: 2,
      episodeEnd: 3,
    });
  });

  it('drops a range that ends before it starts', () => {
    expect(parseMediaName('Show/Season 01/Show S01E05-02.mkv', 'series')).toMatchObject({
      episode: 5,
      episodeEnd: null,
    });
  });

  it('prefers the show folder over the text before the episode code', () => {
    expect(parseMediaName('Dark/Season 01/Dark.2017.S01E01.mkv', 'series')).toMatchObject({
      title: 'Dark',
    });
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

  it.each(['Show/Random clip.mkv', 'Show/Show - 2011-11-15.mkv', 'Show/Show 042.mkv'])(
    'returns unknown for the unsupported form %s (still playable)',
    (name) => {
      expect(parseMediaName(name, 'series')).toMatchObject({ kind: 'unknown', season: null });
    },
  );

  it('uses the stem when nothing else names the episode', () => {
    expect(parseMediaName('S01E02.mkv', 'series')).toMatchObject({ title: 'S01E02', season: 1 });
  });
});

describe('isExtra', () => {
  it.each([
    'Matrix (1999)/extras/Making of.mkv',
    'Matrix (1999)/Behind The Scenes/clip.mkv',
    'Matrix (1999)/Matrix (1999)-trailer.mkv',
    'Matrix (1999)/Preview.sample.mkv',
    'Matrix (1999)/trailer.mp4',
    'Show/Season 01/Show S01E01_clip.mkv',
  ])('detects the extra %s', (path) => {
    expect(isExtra(path)).toBe(true);
  });

  it.each([
    'Matrix (1999)/Matrix (1999).mkv',
    'Show/Season 01/Show S01E01.mkv',
    'The Other.mkv',
    'Hot Clip (2019).mkv',
    'Shorts/A Short (2019).mkv',
  ])('keeps the regular file %s', (path) => {
    expect(isExtra(path)).toBe(false);
  });
});
