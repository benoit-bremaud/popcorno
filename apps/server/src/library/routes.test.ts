import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, Library } from '@popcorntv/shared';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/index.js';
import type { Prober } from './ffprobe.js';

describe('library routes', () => {
  let app: FastifyInstance;
  let mediaRoot: string;
  let root: string;
  let probe: ReturnType<typeof vi.fn<Prober>>;

  beforeEach(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'popcorntv-routes-'));
    root = join(mediaRoot, 'films');
    await mkdir(root);
    probe = vi.fn<Prober>(async () => ({ durationSec: 60, streams: [] }));
    app = buildApp({
      version: 'test',
      db: openDatabase(':memory:'),
      probe,
      mediaRoot,
      tmdb: null,
      artworkDir: join(mediaRoot, 'artwork'),
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

  async function createLibrary(rootPath = root): Promise<Library> {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: 'Films', rootPath, kind: 'films' },
    });
    expect(response.statusCode).toBe(201);
    return response.json<Library>();
  }

  it('creates and lists libraries', async () => {
    const library = await createLibrary();

    const list = await app.inject({ method: 'GET', url: '/libraries' });

    expect(library).toMatchObject({ name: 'Films', rootPath: root, kind: 'films' });
    expect(list.json()).toEqual([library]);
  });

  it('accepts the media root itself and normalises the path', async () => {
    const library = await createLibrary(`${mediaRoot}/films/../`);

    expect(library.rootPath).toBe(mediaRoot);
  });

  it('rejects an invalid body with the path and message of each issue only', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: '', rootPath: 'relative/path', kind: 'music' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string; details: { path: string[]; message: string }[] }>();
    expect(body.error).toBe('invalid_request');
    expect(body.details.map((issue) => issue.path[0]).sort()).toEqual(['kind', 'name', 'rootPath']);
    expect(Object.keys(body.details[0] ?? {}).sort()).toEqual(['message', 'path']);
  });

  it('rejects a root outside MEDIA_ROOT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: 'Etc', rootPath: '/etc', kind: 'films' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().details).toEqual([
      { path: ['rootPath'], message: 'rootPath must be under MEDIA_ROOT' },
    ]);
  });

  it('scans a library and lists its media with relative paths', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'Heat (1995).mkv'), 'x');

    const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const media = await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` });

    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toEqual({ added: 1, updated: 0, removed: 0, skipped: [], metadata: null });
    expect(media.json()).toEqual([
      expect.objectContaining({
        title: 'Heat',
        year: 1995,
        relativePath: 'Heat (1995).mkv',
        durationSec: 60,
        streams: [],
      }),
    ]);
    expect(media.body).not.toContain(mediaRoot);
  });

  it.each([
    ['POST', 'scan'],
    ['GET', 'media'],
  ] as const)('%s /libraries/:id/%s answers 404 for an unknown library', async (method, action) => {
    const response = await app.inject({
      method,
      url: `/libraries/${crypto.randomUUID()}/${action}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'library_not_found' });
  });

  it.each([
    ['POST', 'scan'],
    ['GET', 'media'],
  ] as const)('%s /libraries/:id/%s answers 400 for a malformed id', async (method, action) => {
    const response = await app.inject({ method, url: `/libraries/not-a-uuid/${action}` });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error).toBe('invalid_request');
  });

  it('answers 409 when the root cannot be read', async () => {
    const library = await createLibrary(join(root, 'missing'));

    const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });

    expect(scan.statusCode).toBe(409);
    expect(scan.json()).toEqual({ error: 'root_unreadable' });
  });

  it('answers 409 while a scan of the same library is running', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'Heat (1995).mkv'), 'x');
    let release: () => void = () => undefined;
    probe.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ durationSec: 1, streams: [] }))),
    );

    const first = app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    const second = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    release();

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'scan_running' });
    expect((await first).statusCode).toBe(200);
  });
});
