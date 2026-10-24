import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, EnrichReport, Library, Media, ScanReport } from '@popcorno/shared';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/index.js';
import type { TmdbClient } from './tmdb-client.js';

const DIGEST = 'a'.repeat(64);

/** A TMDB double that matches every search with one title and serves one-byte images. */
function makeClient(): TmdbClient {
  return {
    search: vi.fn(async () => [{ id: 603, year: 1999 }]),
    findByImdb: vi.fn(async () => []),
    details: vi.fn(async () => ({
      id: 603,
      title: 'The Matrix',
      overview: 'Neo.',
      genres: [{ id: 28, name: 'Action' }],
      date: '1999-03-30',
      runtimeMin: 136,
      vote_average: 8.2,
      vote_count: 100,
      poster_path: '/p.jpg',
      backdrop_path: null,
      cast: [],
    })),
    season: vi.fn(async () => []),
    image: vi.fn(async () => new Uint8Array([1])),
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

describe('metadata routes', () => {
  let app: FastifyInstance;
  let mediaRoot: string;
  let artworkDir: string;
  let root: string;
  let tmdb: TmdbClient;

  beforeEach(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'popcorno-meta-routes-'));
    artworkDir = join(mediaRoot, 'artwork');
    root = join(mediaRoot, 'films');
    await mkdir(root);
    tmdb = makeClient();
    app = buildApp({
      version: 'test',
      db: openDatabase(':memory:'),
      probe: async () => ({ durationSec: 60, streams: [] }),
      mediaRoot,
      tmdb,
      artworkDir,
      transcoder: () => {
        throw new Error('FFmpeg is not used by this suite');
      },
      transcodeDir: tmpdir(),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function createLibrary(): Promise<Library> {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: 'Films', rootPath: root, kind: 'films' },
    });
    return response.json<Library>();
  }

  it('enriches after a scan (UC1 include) and exposes the metadata on the media list', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');

    const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const list = await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` });

    expect(scan.statusCode).toBe(200);
    expect(scan.json<ScanReport>().metadata).toEqual({
      matched: 1,
      unmatched: [],
      failed: [],
      skipped: 0,
    });
    const [item] = list.json<Media[]>();
    expect(item?.title).toBe('The Matrix');
    expect(item?.metadata).toMatchObject({
      tmdbId: 603,
      overview: 'Neo.',
      genres: [{ id: 28, name: 'Action' }],
      voteAverage: 8.2,
      backdropPath: null,
    });
    expect(item?.metadata?.posterPath).toMatch(/^[a-f0-9]{64}\.jpg$/);
  });

  it('serves a cached poster with its content type and immutable caching', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const list = await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` });
    const file = list.json<Media[]>()[0]?.metadata?.posterPath;

    const response = await app.inject({ method: 'GET', url: `/artwork/${file}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['content-length']).toBe('1');
    expect(response.headers['cache-control']).toContain('immutable');
    expect([...response.rawPayload]).toEqual([1]);
  });

  it('serves png with its own content type', async () => {
    await mkdir(artworkDir, { recursive: true });
    await writeFile(join(artworkDir, `${DIGEST}.png`), 'p');

    const response = await app.inject({ method: 'GET', url: `/artwork/${DIGEST}.png` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
  });

  it('rejects any artwork name that is not a digest, and 404s a missing one', async () => {
    const bad = await app.inject({ method: 'GET', url: '/artwork/..%2Fpopcorno.sqlite' });
    const missing = await app.inject({ method: 'GET', url: `/artwork/${DIGEST}.jpg` });

    expect(bad.statusCode).toBe(400);
    expect(bad.json<ApiError>().error).toBe('invalid_request');
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiError>().error).toBe('artwork_not_found');
  });

  it('runs UC2 on demand, skipping what is already enriched unless refresh is asked', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });

    const plain = await app.inject({ method: 'POST', url: `/libraries/${library.id}/enrich` });
    const refresh = await app.inject({
      method: 'POST',
      url: `/libraries/${library.id}/enrich`,
      payload: { refresh: true },
    });

    expect(plain.statusCode).toBe(200);
    expect(plain.json<EnrichReport>()).toEqual({
      matched: 0,
      unmatched: [],
      failed: [],
      skipped: 1,
    });
    expect(refresh.json<EnrichReport>()).toEqual({
      matched: 1,
      unmatched: [],
      failed: [],
      skipped: 0,
    });
  });

  it('validates the enrich body and the library id', async () => {
    const library = await createLibrary();

    const badBody = await app.inject({
      method: 'POST',
      url: `/libraries/${library.id}/enrich`,
      payload: { refresh: 'yes' },
    });
    const badId = await app.inject({ method: 'POST', url: '/libraries/nope/enrich' });
    const unknown = await app.inject({
      method: 'POST',
      url: '/libraries/00000000-0000-4000-8000-000000000000/enrich',
    });

    expect(badBody.statusCode).toBe(400);
    expect(badId.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiError>().error).toBe('library_not_found');
  });

  it('answers 409 enrich_running while a run is in flight', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');
    const blocked = deferred<readonly { id: number; year: number }[]>();
    vi.mocked(tmdb.search).mockImplementation(() => blocked.promise);

    // The scan's include holds the lock; the explicit call must be refused meanwhile.
    const scan = app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    await vi.waitFor(() => expect(tmdb.search).toHaveBeenCalled());
    const concurrent = await app.inject({ method: 'POST', url: `/libraries/${library.id}/enrich` });
    blocked.resolve([]);
    await scan;

    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json<ApiError>().error).toBe('enrich_running');
  });

  it('answers 409 scan_running to a scan while an enrichment is in flight', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const blocked = deferred<readonly { id: number; year: number }[]>();
    vi.mocked(tmdb.search)
      .mockClear()
      .mockImplementation(() => blocked.promise);

    // The explicit refresh holds the shared lock: a scan could re-parse a file the
    // enrichment is about to save, so it is refused rather than interleaved.
    const refresh = app.inject({
      method: 'POST',
      url: `/libraries/${library.id}/enrich`,
      payload: { refresh: true },
    });
    await vi.waitFor(() => expect(tmdb.search).toHaveBeenCalled());
    const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    blocked.resolve([{ id: 603, year: 1999 }]);
    await refresh;

    expect(scan.statusCode).toBe(409);
    expect(scan.json<ApiError>().error).toBe('scan_running');
  });

  it('answers 409 enrich_running to a second enrichment while one is in flight', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const blocked = deferred<readonly { id: number; year: number }[]>();
    vi.mocked(tmdb.search)
      .mockClear()
      .mockImplementation(() => blocked.promise);

    const refresh = app.inject({
      method: 'POST',
      url: `/libraries/${library.id}/enrich`,
      payload: { refresh: true },
    });
    await vi.waitFor(() => expect(tmdb.search).toHaveBeenCalled());
    const second = await app.inject({ method: 'POST', url: `/libraries/${library.id}/enrich` });
    blocked.resolve([{ id: 603, year: 1999 }]);

    expect(second.statusCode).toBe(409);
    expect(second.json<ApiError>().error).toBe('enrich_running');
    expect((await refresh).statusCode).toBe(200);
  });

  describe('without a TMDB key', () => {
    beforeEach(async () => {
      await app.close();
      app = buildApp({
        version: 'test',
        db: openDatabase(':memory:'),
        probe: async () => ({ durationSec: 60, streams: [] }),
        mediaRoot,
        tmdb: null,
        artworkDir,
        transcoder: () => {
          throw new Error('FFmpeg is not used by this suite');
        },
        transcodeDir: tmpdir(),
      });
    });

    it('answers 409 tmdb_not_configured and scans with metadata null', async () => {
      const library = await createLibrary();
      await writeFile(join(root, 'The Matrix (1999).mkv'), 'x');

      const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
      const enrich = await app.inject({ method: 'POST', url: `/libraries/${library.id}/enrich` });

      expect(scan.json<ScanReport>().metadata).toBeNull();
      expect(enrich.statusCode).toBe(409);
      expect(enrich.json<ApiError>().error).toBe('tmdb_not_configured');
    });
  });
});
