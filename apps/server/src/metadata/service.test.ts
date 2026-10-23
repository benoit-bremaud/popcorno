import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Library, ProviderIds } from '@popcorno/shared';
import { openDatabase } from '../db/index.js';
import type { AppDatabase } from '../db/index.js';
import { LibraryRepository } from '../library/repository.js';
import type { MediaInput } from '../library/repository.js';
import { ArtworkCache } from './artwork-cache.js';
import { MetadataRepository } from './repository.js';
import { EnrichRunningError, MetadataService } from './service.js';
import { TmdbRequestError } from './tmdb-client.js';
import type { TmdbClient, TmdbEpisode, TmdbTitleDetails } from './tmdb-client.js';

const NOW = new Date('2026-10-23T10:00:00.000Z');

function details(
  id: number,
  title: string,
  overrides: Partial<TmdbTitleDetails> = {},
): TmdbTitleDetails {
  return {
    id,
    title,
    overview: `About ${title}`,
    genres: [{ id: 99, name: 'Documentary' }],
    date: '2014-11-05',
    runtimeMin: 169,
    vote_average: 8.4,
    vote_count: 30000,
    poster_path: `/${id}-poster.jpg`,
    backdrop_path: `/${id}-backdrop.jpg`,
    cast: [{ name: 'Matthew McConaughey', character: 'Cooper', profile_path: null, order: 0 }],
    ...overrides,
  };
}

function episode(number: number, name: string): TmdbEpisode {
  return {
    episode_number: number,
    name,
    overview: `Episode ${number}`,
    still_path: `/still-${number}.jpg`,
    air_date: '2017-12-01',
    runtime: 50,
    vote_average: 8,
    vote_count: 10,
  };
}

/** A TMDB double with every method a spy; defaults answer "nothing found". */
function makeClient(overrides: Partial<TmdbClient> = {}) {
  return {
    search: vi.fn<TmdbClient['search']>(async () => []),
    findByImdb: vi.fn<TmdbClient['findByImdb']>(async () => []),
    details: vi.fn<TmdbClient['details']>(async (_kind, id) => details(id, `Title ${id}`)),
    season: vi.fn<TmdbClient['season']>(async () => []),
    image: vi.fn<TmdbClient['image']>(async () => new Uint8Array([1])),
    ...overrides,
  };
}

/** A promise the test resolves by hand, to hold a TMDB call open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('MetadataService', () => {
  let db: AppDatabase;
  let libraries: LibraryRepository;
  let repository: MetadataRepository;
  let artworkDir: string;
  let library: Library;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    libraries = new LibraryRepository(db);
    repository = new MetadataRepository(db);
    artworkDir = await mkdtemp(join(tmpdir(), 'popcorno-meta-'));
    library = libraries.createLibrary({ name: 'Films', rootPath: '/m', kind: 'films' });
  });

  afterEach(async () => {
    logger.warn.mockReset();
    await rm(artworkDir, { recursive: true, force: true });
  });

  const logger = { warn: vi.fn() };

  function makeService(client: TmdbClient): MetadataService {
    return new MetadataService({
      repository,
      client,
      artwork: new ArtworkCache(artworkDir, client),
      logger,
      now: () => NOW,
    });
  }

  function addFilm(title: string, year: number | null, providerIds: ProviderIds = {}): string {
    const input: MediaInput = {
      kind: 'film',
      title,
      year,
      season: null,
      episode: null,
      episodeEnd: null,
      providerIds,
      edition: null,
      part: null,
      filePath: `/m/${title} (${year ?? 'x'}).mkv`,
      relativePath: `${title} (${year ?? 'x'}).mkv`,
      fileSize: 1,
      fileMtimeMs: 1,
      durationSec: null,
      seriesId: null,
    };
    return libraries.upsertMedia(library.id, input, []);
  }

  function addEpisode(
    seriesLibrary: Library,
    seriesId: string,
    season: number,
    number: number,
  ): string {
    return libraries.upsertMedia(
      seriesLibrary.id,
      {
        kind: 'episode',
        title: 'Dark',
        year: 2017,
        season,
        episode: number,
        episodeEnd: null,
        providerIds: {},
        edition: null,
        part: null,
        filePath: `/s/Dark/S${season}E${number}.mkv`,
        relativePath: `Dark/S${season}E${number}.mkv`,
        fileSize: 1,
        fileMtimeMs: 1,
        durationSec: null,
        seriesId,
      },
      [],
    );
  }

  function metadataOf(id: string) {
    return libraries.listMedia(library.id).find((item) => item.id === id)?.metadata ?? null;
  }

  it('matches a film by title and year, persists the metadata and caches the artwork', async () => {
    const id = addFilm('Interstellar', 2014);
    const client = makeClient({
      search: vi.fn(async () => [
        { id: 1, year: 2010 },
        { id: 157336, year: 2014 },
      ]),
    });

    const report = await makeService(client).enrich(library);

    expect(report).toEqual({ matched: 1, unmatched: [], failed: [], skipped: 0 });
    expect(client.search).toHaveBeenCalledWith('movie', 'Interstellar', 2014);
    expect(client.details).toHaveBeenCalledWith('movie', 157336);
    const metadata = metadataOf(id);
    expect(metadata).toMatchObject({
      tmdbId: 157336,
      overview: 'About Title 157336',
      genres: [{ id: 99, name: 'Documentary' }],
      releaseDate: '2014-11-05',
      runtimeMin: 169,
      voteAverage: 8.4,
      voteCount: 30000,
      cast: [{ name: 'Matthew McConaughey', character: 'Cooper', profilePath: null }],
      fetchedAt: NOW.toISOString(),
    });
    expect(metadata?.posterPath).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(metadata?.backdropPath).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(client.image).toHaveBeenCalledWith('/157336-poster.jpg', 'w500');
    expect(client.image).toHaveBeenCalledWith('/157336-backdrop.jpg', 'w1280');
    expect(libraries.listMedia(library.id)[0]?.title).toBe('Title 157336');
  });

  it('uses a tmdb tag directly, without searching', async () => {
    addFilm('Whatever', 2000, { tmdb: '603' });
    const client = makeClient();

    await makeService(client).enrich(library);

    expect(client.search).not.toHaveBeenCalled();
    expect(client.details).toHaveBeenCalledWith('movie', 603);
  });

  it('ignores a tag that is not a whole number and searches instead', async () => {
    addFilm('Whatever', 2000, { tmdb: '12abc' });
    const client = makeClient();

    await makeService(client).enrich(library);

    expect(client.details).not.toHaveBeenCalled();
    expect(client.search).toHaveBeenCalledWith('movie', 'Whatever', 2000);
  });

  it('searches an unknown-kind row with the library kind', async () => {
    libraries.upsertMedia(
      library.id,
      {
        kind: 'unknown',
        title: 'Mystery',
        year: null,
        season: null,
        episode: null,
        episodeEnd: null,
        providerIds: {},
        edition: null,
        part: null,
        filePath: '/m/Mystery.mkv',
        relativePath: 'Mystery.mkv',
        fileSize: 1,
        fileMtimeMs: 1,
        durationSec: null,
        seriesId: null,
      },
      [],
    );
    const client = makeClient();

    const report = await makeService(client).enrich(library);

    expect(client.search).toHaveBeenCalledWith('movie', 'Mystery', null);
    expect(report.unmatched).toEqual([{ title: 'Mystery', year: null }]);
  });

  it('looks a title up again after a rescan changed its file', async () => {
    const id = addFilm('Interstellar', 2014);
    const client = makeClient({ search: vi.fn(async () => [{ id: 157336, year: 2014 }]) });
    const service = makeService(client);
    await service.enrich(library);

    addFilm('Interstellar', 2014); // The scanner upserts a changed file at the same path.
    const report = await service.enrich(library);

    expect(libraries.listMedia(library.id).map((item) => item.id)).toEqual([id]);
    expect(report).toEqual({ matched: 1, unmatched: [], failed: [], skipped: 0 });
    expect(client.details).toHaveBeenCalledTimes(2);
  });

  it('resolves an imdb tag through /find', async () => {
    addFilm('Whatever', 2000, { imdb: 'tt0133093' });
    const client = makeClient({ findByImdb: vi.fn(async () => [{ id: 603, year: 1999 }]) });

    await makeService(client).enrich(library);

    expect(client.findByImdb).toHaveBeenCalledWith('movie', 'tt0133093');
    expect(client.search).not.toHaveBeenCalled();
    expect(client.details).toHaveBeenCalledWith('movie', 603);
  });

  it('retries the search without the year and accepts a one-year gap', async () => {
    addFilm('Blade Runner 2049', 2018);
    const search = vi.fn<TmdbClient['search']>(async (_kind, _title, year) =>
      year === null ? [{ id: 335984, year: 2017 }] : [],
    );
    const client = makeClient({ search });

    const report = await makeService(client).enrich(library);

    expect(report.matched).toBe(1);
    expect(search).toHaveBeenNthCalledWith(1, 'movie', 'Blade Runner 2049', 2018);
    expect(search).toHaveBeenNthCalledWith(2, 'movie', 'Blade Runner 2049', null);
    expect(client.details).toHaveBeenCalledWith('movie', 335984);
  });

  it('marks a title unmatched when nothing qualifies and does not re-ask it next run', async () => {
    const id = addFilm('Home Video', null);
    const client = makeClient();
    const service = makeService(client);

    const first = await service.enrich(library);
    const second = await service.enrich(library);

    expect(first).toEqual({
      matched: 0,
      unmatched: [{ title: 'Home Video', year: null }],
      failed: [],
      skipped: 0,
    });
    expect(metadataOf(id)).toMatchObject({ tmdbId: null, fetchedAt: NOW.toISOString() });
    expect(second).toEqual({ matched: 0, unmatched: [], failed: [], skipped: 1 });
    expect(client.search).toHaveBeenCalledTimes(1);
  });

  it('re-fetches every title with refresh, including unmatched ones', async () => {
    addFilm('Home Video', null);
    const client = makeClient();
    const service = makeService(client);

    await service.enrich(library);
    const report = await service.enrich(library, { refresh: true });

    expect(report.skipped).toBe(0);
    expect(client.search).toHaveBeenCalledTimes(2);
  });

  it('treats an unknown provider id (404) as unmatched', async () => {
    const id = addFilm('Whatever', 2000, { tmdb: '1' });
    const client = makeClient({
      details: vi.fn(async () => {
        throw new TmdbRequestError('/movie/1', 404);
      }),
    });

    const report = await makeService(client).enrich(library);

    expect(report.unmatched).toEqual([{ title: 'Whatever', year: 2000 }]);
    expect(metadataOf(id)?.tmdbId).toBeNull();
  });

  it('reports a request failure and leaves the row pending for the next run', async () => {
    const id = addFilm('Interstellar', 2014);
    const client = makeClient({
      search: vi.fn(async () => {
        throw new TmdbRequestError('/search/movie', 503);
      }),
    });

    const report = await makeService(client).enrich(library);

    expect(report).toEqual({
      matched: 0,
      unmatched: [],
      failed: [{ title: 'Interstellar', year: 2014 }],
      skipped: 0,
    });
    expect(metadataOf(id)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(TmdbRequestError),
      expect.stringContaining('Interstellar'),
    );
  });

  it('keeps going after a failure', async () => {
    addFilm('Bad', 2000);
    addFilm('Good', 2001);
    const search = vi.fn<TmdbClient['search']>(async (_kind, title, year) => {
      if (title === 'Bad') throw new Error('boom');
      return [{ id: 2, year }];
    });

    const report = await makeService(makeClient({ search })).enrich(library);

    expect(report.matched).toBe(1);
    expect(report.failed).toEqual([{ title: 'Bad', year: 2000 }]);
  });

  it('processes titles one after the other, never two requests in flight', async () => {
    addFilm('One', 2000);
    addFilm('Two', 2001);
    let inFlight = 0;
    let maxInFlight = 0;
    const search = vi.fn<TmdbClient['search']>(async (_kind, _title, year) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); // Yield once so a concurrent call could overlap if it existed.
      inFlight -= 1;
      return [{ id: 2, year }];
    });

    await makeService(makeClient({ search })).enrich(library);

    expect(search).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it('still counts a title matched when its artwork download fails, and logs it', async () => {
    const id = addFilm('Interstellar', 2014);
    const client = makeClient({
      search: vi.fn(async () => [{ id: 5, year: 2014 }]),
      image: vi.fn(async () => {
        throw new Error('cdn down');
      }),
    });

    const report = await makeService(client).enrich(library);

    expect(report.matched).toBe(1);
    expect(metadataOf(id)).toMatchObject({ tmdbId: 5, posterPath: null, backdropPath: null });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining('w500'));
  });

  it('refuses a second run on the same library while one is in flight', async () => {
    addFilm('Interstellar', 2014);
    const blocked = deferred<readonly { id: number; year: number }[]>();
    const search = vi.fn<TmdbClient['search']>(() => blocked.promise);
    const service = makeService(makeClient({ search }));

    const first = service.enrich(library);
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    const concurrent = service.enrich(library);
    blocked.resolve([{ id: 1, year: 2014 }]);

    await expect(concurrent).rejects.toBeInstanceOf(EnrichRunningError);
    await first;
    await expect(service.enrich(library)).resolves.toBeDefined();
  });

  it('enriches a series and its episodes with one season request per season', async () => {
    const series = libraries.createLibrary({ name: 'Series', rootPath: '/s', kind: 'series' });
    const seriesId = libraries.findOrCreateSeries(series.id, 'Dark', 2017, {});
    const e1 = addEpisode(series, seriesId, 1, 1);
    const e2 = addEpisode(series, seriesId, 1, 2);
    const e3 = addEpisode(series, seriesId, 2, 1);
    const client = makeClient({
      search: vi.fn(async () => [{ id: 70523, year: 2017 }]),
      season: vi.fn(async (_id, season) =>
        season === 1 ? [episode(1, 'Secrets'), episode(2, 'Lies')] : [episode(1, 'Beginnings')],
      ),
    });

    const report = await makeService(client).enrich(series);

    expect(report).toEqual({ matched: 1, unmatched: [], failed: [], skipped: 0 });
    expect(client.search).toHaveBeenCalledWith('tv', 'Dark', 2017);
    expect(client.details).toHaveBeenCalledWith('tv', 70523);
    expect(client.season).toHaveBeenCalledTimes(2);
    expect(client.season).toHaveBeenCalledWith(70523, 1);
    expect(client.season).toHaveBeenCalledWith(70523, 2);
    const items = libraries.listMedia(series.id);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(seriesId)?.metadata?.tmdbId).toBe(70523);
    expect(byId.get(e1)?.title).toBe('Secrets');
    expect(byId.get(e2)?.title).toBe('Lies');
    expect(byId.get(e3)?.title).toBe('Beginnings');
    expect(byId.get(e1)?.metadata).toMatchObject({
      tmdbId: 70523,
      overview: 'Episode 1',
      releaseDate: '2017-12-01',
      runtimeMin: 50,
      genres: [],
      cast: [],
      backdropPath: null,
    });
    expect(byId.get(e1)?.metadata?.posterPath).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(client.image).toHaveBeenCalledWith('/still-1.jpg', 'w500');
  });

  it('keeps the parsed episode fields when a season is missing or an episode is absent', async () => {
    const series = libraries.createLibrary({ name: 'Series', rootPath: '/s', kind: 'series' });
    const seriesId = libraries.findOrCreateSeries(series.id, 'Dark', 2017, {});
    const missingSeason = addEpisode(series, seriesId, 9, 1);
    const absentEpisode = addEpisode(series, seriesId, 1, 7);
    const client = makeClient({
      search: vi.fn(async () => [{ id: 70523, year: 2017 }]),
      season: vi.fn(async (_id, season) => {
        if (season === 9) throw new TmdbRequestError('/tv/70523/season/9', 404);
        return [episode(1, 'Secrets')];
      }),
    });

    const report = await makeService(client).enrich(series);

    expect(report.matched).toBe(1);
    const byId = new Map(libraries.listMedia(series.id).map((item) => [item.id, item]));
    expect(byId.get(missingSeason)?.title).toBe('Dark');
    expect(byId.get(missingSeason)?.metadata).toBeNull();
    expect(byId.get(absentEpisode)?.title).toBe('Dark');
    expect(byId.get(absentEpisode)?.metadata).toMatchObject({ tmdbId: null });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(TmdbRequestError),
      expect.stringContaining('season 9'),
    );
  });

  it('keeps the metadata of an episode that a refreshed season no longer lists', async () => {
    const series = libraries.createLibrary({ name: 'Series', rootPath: '/s', kind: 'series' });
    const seriesId = libraries.findOrCreateSeries(series.id, 'Dark', 2017, {});
    const e1 = addEpisode(series, seriesId, 1, 1);
    let listed = [episode(1, 'Secrets')];
    const client = makeClient({
      search: vi.fn(async () => [{ id: 70523, year: 2017 }]),
      season: vi.fn(async () => listed),
    });
    const service = makeService(client);

    await service.enrich(series);
    listed = [];
    await service.enrich(series, { refresh: true });

    const item = libraries.listMedia(series.id).find((row) => row.id === e1);
    expect(item?.title).toBe('Secrets');
    expect(item?.metadata).toMatchObject({ tmdbId: 70523, overview: 'Episode 1' });
  });

  it('revisits a matched series when a later scan adds an episode', async () => {
    const series = libraries.createLibrary({ name: 'Series', rootPath: '/s', kind: 'series' });
    const seriesId = libraries.findOrCreateSeries(series.id, 'Dark', 2017, {});
    addEpisode(series, seriesId, 1, 1);
    const client = makeClient({
      search: vi.fn(async () => [{ id: 70523, year: 2017 }]),
      season: vi.fn(async () => [episode(1, 'Secrets'), episode(2, 'Lies')]),
    });
    const service = makeService(client);
    await service.enrich(series);

    const e2 = addEpisode(series, seriesId, 1, 2);
    const report = await service.enrich(series);
    const afterwards = await service.enrich(series);

    expect(report).toEqual({ matched: 1, unmatched: [], failed: [], skipped: 1 });
    expect(libraries.listMedia(series.id).find((row) => row.id === e2)?.title).toBe('Lies');
    expect(afterwards).toEqual({ matched: 0, unmatched: [], failed: [], skipped: 1 });
  });
});
