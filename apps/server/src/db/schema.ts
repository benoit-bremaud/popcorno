import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { LIBRARY_KINDS, MEDIA_KINDS, STREAM_TYPES } from '@popcorno/shared';
import type { ProviderIds } from '@popcorno/shared';

/** Persistence shape of the class diagram (04-class.md); tables derive from the entities. */

/** One row per registered media folder (`Library` entity). */
export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  kind: text('kind', { enum: LIBRARY_KINDS }).notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * One row per scanned file plus one per series (`Media` entity). `file_path` is the real
 * absolute path used for playback, unique per library; `relative_path` is what the API
 * exposes; `file_size` + `file_mtime_ms` are the re-scan fingerprint (spec 7b).
 */
export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    filePath: text('file_path'),
    relativePath: text('relative_path'),
    fileSize: integer('file_size'),
    fileMtimeMs: integer('file_mtime_ms'),
    durationSec: integer('duration_sec'),
    season: integer('season'),
    episode: integer('episode'),
    episodeEnd: integer('episode_end'),
    seriesId: text('series_id'),
    providerIds: text('provider_ids', { mode: 'json' })
      .$type<ProviderIds>()
      .notNull()
      .default(sql`'{}'`),
    edition: text('edition'),
    part: integer('part'),
  },
  (table) => [
    uniqueIndex('media_library_file_idx').on(table.libraryId, table.filePath),
    index('media_series_idx').on(table.seriesId),
  ],
);

/** Technical streams of a file (`StreamInfo` entity), replaced whole on every re-probe. */
export const streams = sqliteTable('streams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: text('media_id')
    .notNull()
    .references(() => media.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  type: text('type', { enum: STREAM_TYPES }).notNull(),
  codec: text('codec').notNull(),
  width: integer('width'),
  height: integer('height'),
  language: text('language'),
});
