import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Library } from '@popcorno/shared';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('library routes', () => {
  let app: FastifyInstance;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'popcorno-routes-'));
    app = buildApp({
      version: 'test',
      db: openDatabase(':memory:'),
      probe: async () => ({ durationSec: 60, streams: [] }),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  async function createLibrary(): Promise<Library> {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: 'Films', rootPath: root, kind: 'films' },
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

  it('rejects an invalid body with the zod issues', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: '', rootPath: 'relative/path', kind: 'music' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string; details: { path: string[] }[] }>();
    expect(body.error).toBe('invalid_request');
    expect(body.details.map((issue) => issue.path[0]).sort()).toEqual(['kind', 'name', 'rootPath']);
  });

  it('scans a library and lists its media', async () => {
    const library = await createLibrary();
    await writeFile(join(root, 'Heat (1995).mkv'), 'x');

    const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const media = await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` });

    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toEqual({ added: 1, updated: 0, removed: 0, skipped: [] });
    expect(media.json()).toMatchObject([
      { title: 'Heat', year: 1995, durationSec: 60, streams: [] },
    ]);
  });

  it('answers 404 for an unknown library and 400 for a malformed id', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: `/libraries/${crypto.randomUUID()}/scan`,
    });
    const malformed = await app.inject({ method: 'GET', url: '/libraries/not-a-uuid/media' });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'library_not_found' });
    expect(malformed.statusCode).toBe(400);
  });

  it('answers 409 when the root cannot be read', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: 'Ghost', rootPath: join(root, 'missing'), kind: 'films' },
    });
    const library = response.json<Library>();

    const scan = await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });

    expect(scan.statusCode).toBe(409);
    expect(scan.json()).toEqual({ error: 'root_unreadable' });
  });
});
