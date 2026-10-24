import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { MediaKind, WatchProgress } from '@popcorno/shared';
import { openDatabase } from '../db/index.js';
import type { AppDatabase } from '../db/index.js';
import { libraries, media } from '../db/schema.js';
import { ProgressRepository } from './repository.js';
import { registerProgressRoutes } from './routes.js';

/** An in-memory database with one library; `addMedia` inserts a row and returns its id. */
function progressDb(): {
  readonly db: AppDatabase;
  readonly addMedia: (kind: MediaKind, durationSec: number | null) => string;
} {
  const db = openDatabase(':memory:');
  const libraryId = randomUUID();
  db.insert(libraries)
    .values({ id: libraryId, name: 'Films', rootPath: '/m', kind: 'films', createdAt: '' })
    .run();
  const addMedia = (kind: MediaKind, durationSec: number | null): string => {
    const id = randomUUID();
    db.insert(media).values({ id, libraryId, kind, title: id, durationSec }).run();
    return id;
  };
  return { db, addMedia };
}

function setup() {
  const { db, addMedia } = progressDb();
  const app = Fastify();
  registerProgressRoutes(app, { progress: new ProgressRepository(db) });
  return { app, addMedia };
}

describe('progress routes', () => {
  it('stores a position and returns it from GET /progress', async () => {
    const { app, addMedia } = setup();
    const id = addMedia('film', 100);

    const put = await app.inject({
      method: 'PUT',
      url: `/media/${id}/progress`,
      payload: { positionSec: 30 },
    });
    const list = await app.inject({ method: 'GET', url: '/progress' });

    expect(put.statusCode).toBe(204);
    expect(list.json<WatchProgress[]>()).toMatchObject([
      { mediaId: id, positionSec: 30, durationSec: 100, finished: false },
    ]);
  });

  it('answers 404 media_not_found for an unknown media', async () => {
    const { app } = setup();

    const response = await app.inject({
      method: 'PUT',
      url: '/media/00000000-0000-4000-8000-000000000000/progress',
      payload: { positionSec: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'media_not_found' });
  });

  it.each([{ positionSec: -1 }, { positionSec: 1.5 }, {}, { positionSec: '3' }])(
    'rejects the body %j',
    async (payload) => {
      const { app, addMedia } = setup();
      const id = addMedia('film', 100);

      const response = await app.inject({ method: 'PUT', url: `/media/${id}/progress`, payload });

      expect(response.statusCode).toBe(400);
    },
  );

  it('rejects a media id that is not a uuid', async () => {
    const { app } = setup();

    const response = await app.inject({
      method: 'PUT',
      url: '/media/abc/progress',
      payload: { positionSec: 1 },
    });

    expect(response.statusCode).toBe(400);
  });
});
