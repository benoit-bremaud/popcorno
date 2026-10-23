import { describe, expect, it } from 'vitest';
import { ACTION, DOCUMENTARY, DRAMA, media, metadata } from '../test-fixtures.js';
import {
  availableGenres,
  byGenreRows,
  availableTypes,
  catalogItems,
  genreRows,
  heroItem,
  homeRows,
  ofGenre,
  seasonsOf,
  topRated,
  typeOf,
} from './catalog.js';

const film = media({ id: 'f', title: 'Heat', metadata: metadata({ genres: [ACTION, DRAMA] }) });
const docFilm = media({ id: 'd', title: 'Planet', metadata: metadata({ genres: [DOCUMENTARY] }) });
const series = media({ id: 's', title: 'Dark', kind: 'series' });
const episode = media({
  id: 'e',
  title: 'Pilot',
  kind: 'episode',
  seriesId: 's',
  season: 1,
  episode: 1,
});
const unknown = media({ id: 'u', title: 'clip', kind: 'unknown' });

function rated(id: string, title: string, voteAverage: number, voteCount: number) {
  return media({ id, title, metadata: metadata({ voteAverage, voteCount }) });
}

describe('typeOf', () => {
  it('maps documentaries first, then the media kind', () => {
    expect(typeOf(docFilm)).toBe('documentaries');
    expect(typeOf(film)).toBe('films');
    expect(typeOf(series)).toBe('series');
    expect(typeOf(unknown)).toBe('others');
  });

  it('treats a documentary series as a documentary', () => {
    const docSeries = media({
      id: 'ds',
      title: 'Cosmos',
      kind: 'series',
      metadata: metadata({ genres: [DOCUMENTARY] }),
    });
    expect(typeOf(docSeries)).toBe('documentaries');
  });
});

describe('catalogItems / availableTypes', () => {
  it('drops episodes and lists only non-empty types in display order', () => {
    const items = catalogItems([unknown, episode, series, film]);
    expect(items.map((item) => item.id)).toEqual(['u', 's', 'f']);
    expect(availableTypes(items)).toEqual(['films', 'series', 'others']);
  });
});

describe('topRated', () => {
  it('keeps rated items with votes, best rating then votes then title, up to the limit', () => {
    const items = [
      rated('a', 'B', 7, 10),
      rated('b', 'A', 7, 10),
      rated('c', 'C', 8, 1),
      rated('d', 'D', 7, 50),
      rated('e', 'E', 9, 0),
      film,
    ];
    expect(topRated(items).map((item) => item.id)).toEqual(['c', 'd', 'b', 'a']);
    expect(topRated(items, 2).map((item) => item.id)).toEqual(['c', 'd']);
  });
});

describe('genres', () => {
  const thriller = media({ id: 't', title: 'Alien', metadata: metadata({ genres: [ACTION] }) });

  it('lists genres by population, never the documentary genre', () => {
    expect(availableGenres([film, thriller, docFilm])).toEqual([ACTION, DRAMA]);
  });

  it('builds one A–Z row per genre', () => {
    const rows = genreRows([film, thriller]);
    expect(rows.map((row) => row.title)).toEqual(['Action', 'Drama']);
    expect(rows[0]?.items.map((item) => item.title)).toEqual(['Alien', 'Heat']);
    expect(ofGenre([film, unknown], DRAMA.id)).toEqual([film]);
  });

  it('breaks population ties by name', () => {
    expect(availableGenres([film])).toEqual([ACTION, DRAMA]);
  });
});

describe('byGenreRows', () => {
  it('adds the titles without genre after the genre rows, only when there are some', () => {
    expect(byGenreRows([film, unknown]).map((row) => row.key)).toEqual([
      'genre-28',
      'genre-18',
      'no-genre',
    ]);
    expect(byGenreRows([film]).map((row) => row.key)).toEqual(['genre-28', 'genre-18']);
  });
});

describe('homeRows', () => {
  it('orders top rated, types, then genres and drops empty rows', () => {
    const best = rated('r', 'Best', 9, 100);
    const rows = homeRows([film, best, series, docFilm]);
    expect(rows.map((row) => row.key)).toEqual([
      'top-rated',
      'type-films',
      'type-series',
      'type-documentaries',
      'genre-28',
      'genre-18',
    ]);
  });
});

describe('heroItem', () => {
  it('prefers the best-rated item with a backdrop, else the first with one, else null', () => {
    const plain = media({ id: 'p', title: 'P', metadata: metadata({ backdropPath: 'p.jpg' }) });
    const star = media({
      id: 's',
      title: 'S',
      metadata: metadata({ backdropPath: 's.jpg', voteAverage: 8, voteCount: 3 }),
    });
    expect(heroItem([plain, star])).toBe(star);
    expect(heroItem([film, plain])).toBe(plain);
    expect(heroItem([film])).toBeNull();
  });
});

describe('seasonsOf', () => {
  it('groups the series episodes by season in order', () => {
    const e2 = media({
      id: 'e2',
      title: 'Two',
      kind: 'episode',
      seriesId: 's',
      season: 1,
      episode: 2,
    });
    const s2 = media({
      id: 's2e1',
      title: 'Next',
      kind: 'episode',
      seriesId: 's',
      season: 2,
      episode: 1,
    });
    const other = media({
      id: 'x',
      title: 'X',
      kind: 'episode',
      seriesId: 'zz',
      season: 1,
      episode: 1,
    });
    const seasons = seasonsOf(series, [s2, e2, other, episode, film]);
    expect(seasons.map((season) => season.season)).toEqual([1, 2]);
    expect(seasons[0]?.episodes.map((item) => item.id)).toEqual(['e', 'e2']);
  });

  it('returns nothing for a film', () => {
    expect(seasonsOf(film, [episode])).toEqual([]);
  });
});
