import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './index.js';
import { libraries, media, streams } from './schema.js';

const REPROBE_COVER_ART = readFileSync(
  new URL('../../drizzle/0003_reprobe-cover-art.sql', import.meta.url),
  'utf8',
);

describe('migration 0003 reprobe-cover-art', () => {
  it('clears the fingerprint of files whose stored probe holds cover art only', () => {
    const db = openDatabase(':memory:');
    db.insert(libraries)
      .values({ id: 'l', name: 'Films', rootPath: '/m', kind: 'films', createdAt: 'now' })
      .run();
    for (const [id, codec] of [
      ['cover', 'mjpeg'],
      ['film', 'hevc'],
    ] as const) {
      db.insert(media)
        .values({ id, libraryId: 'l', kind: 'film', title: id, fileMtimeMs: 1 })
        .run();
      db.insert(streams).values({ mediaId: id, position: 0, type: 'video', codec }).run();
    }

    db.run(sql.raw(REPROBE_COVER_ART));

    const rows = db.select({ id: media.id, mtime: media.fileMtimeMs }).from(media).all();
    expect(rows).toEqual([
      { id: 'cover', mtime: null },
      { id: 'film', mtime: 1 },
    ]);
  });
});
