import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, Library, Media } from '@popcorno/shared';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/index.js';

const CONTENT = '0123456789abcdefghij';

describe('GET /media/:id/file', () => {
  let app: FastifyInstance;
  let base: string;
  let mediaRoot: string;
  let root: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'popcorno-playback-'));
    mediaRoot = join(base, 'media');
    root = join(mediaRoot, 'films');
    await mkdir(root, { recursive: true });
    app = buildApp({
      version: 'test',
      db: openDatabase(':memory:'),
      probe: async () => ({
        durationSec: 60,
        streams: [{ type: 'video', codec: 'h264', width: 1920, height: 1080, language: null }],
      }),
      mediaRoot,
      tmdb: null,
      artworkDir: join(base, 'artwork'),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
  });

  /** Scans one file into a fresh library and returns its media row. */
  async function scanned(name: string): Promise<Media> {
    await writeFile(join(root, name), CONTENT);
    const library = (
      await app.inject({
        method: 'POST',
        url: '/libraries',
        payload: { name: 'Films', rootPath: root, kind: 'films' },
      })
    ).json<Library>();
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const list = await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` });
    const item = list.json<Media[]>().find((media) => media.relativePath === name);
    if (item === undefined) throw new Error(`${name} was not scanned`);
    return item;
  }

  function get(id: string, range?: string) {
    return app.inject({
      method: 'GET',
      url: `/media/${id}/file`,
      headers: range === undefined ? {} : { range },
    });
  }

  it('streams the whole file with 200 when no range is asked', async () => {
    const film = await scanned('Heat (1995).mp4');

    const response = await get(film.id);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-length']).toBe(String(CONTENT.length));
    expect(response.body).toBe(CONTENT);
  });

  it('answers a range with 206 and the requested bytes only', async () => {
    const film = await scanned('Heat (1995).webm');

    const response = await get(film.id, 'bytes=5-9');

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-type']).toBe('video/webm');
    expect(response.headers['content-range']).toBe(`bytes 5-9/${CONTENT.length}`);
    expect(response.headers['content-length']).toBe('5');
    expect(response.body).toBe('56789');
  });

  it('serves an open-ended seek to the end of the file', async () => {
    const film = await scanned('Heat (1995).mkv');

    const response = await get(film.id, 'bytes=15-');

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-type']).toBe('video/x-matroska');
    expect(response.body).toBe('fghij');
  });

  it('falls back to a generic content type for other containers', async () => {
    const film = await scanned('Heat (1995).avi');

    const response = await get(film.id, 'bytes=0-0');

    expect(response.headers['content-type']).toBe('application/octet-stream');
  });

  it('answers 416 with the file size for an unsatisfiable range', async () => {
    const film = await scanned('Heat (1995).mp4');

    const response = await get(film.id, 'bytes=999-');

    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe(`bytes */${CONTENT.length}`);
  });

  it('rejects an id that is not a uuid with 400', async () => {
    const response = await get('..%2F..%2Fetc%2Fpasswd');

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error).toBe('invalid_request');
  });

  it('answers 404 for an unknown id', async () => {
    const response = await get(randomUUID());

    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error).toBe('media_not_found');
  });

  it('answers 404 for a series row, which has no file', async () => {
    await mkdir(join(root, 'Show'));
    await writeFile(join(root, 'Show', 'Show S01E01.mp4'), CONTENT);
    const library = (
      await app.inject({
        method: 'POST',
        url: '/libraries',
        payload: { name: 'Shows', rootPath: root, kind: 'series' },
      })
    ).json<Library>();
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const items = (await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` })).json<
      Media[]
    >();
    const series = items.find((item) => item.kind === 'series');
    if (series === undefined) throw new Error('no series row');

    expect((await get(series.id)).statusCode).toBe(404);
  });

  it('answers 404 once the file vanished after the scan', async () => {
    const film = await scanned('Heat (1995).mp4');
    await unlink(join(root, 'Heat (1995).mp4'));

    expect((await get(film.id)).statusCode).toBe(404);
  });

  it('answers 404 when the file was swapped for a link escaping the root', async () => {
    const film = await scanned('Heat (1995).mp4');
    const outside = join(base, 'secret.txt');
    await writeFile(outside, 'secret');
    await unlink(join(root, 'Heat (1995).mp4'));
    await symlink(outside, join(root, 'Heat (1995).mp4'));

    const response = await get(film.id);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('secret');
  });

  it('answers 404 when the library root was moved out of MEDIA_ROOT', async () => {
    const film = await scanned('Heat (1995).mp4');
    const moved = join(base, 'moved');
    await rename(root, moved);
    await symlink(moved, root);

    expect((await get(film.id)).statusCode).toBe(404);
  });
});
