import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Persistence shape of the class diagram (04-class.md); tables derive from the entities. */

export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  kind: text('kind', { enum: ['films', 'series'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['film', 'episode', 'series', 'unknown'] }).notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    filePath: text('file_path'),
    fileSize: integer('file_size'),
    fileMtimeMs: integer('file_mtime_ms'),
    durationSec: integer('duration_sec'),
    season: integer('season'),
    episode: integer('episode'),
    episodeEnd: integer('episode_end'),
    seriesId: text('series_id'),
    providerIds: text('provider_ids').notNull().default('{}'),
    edition: text('edition'),
    part: integer('part'),
  },
  (table) => [
    uniqueIndex('media_library_file_idx').on(table.libraryId, table.filePath),
    index('media_series_idx').on(table.seriesId),
  ],
);

export const streams = sqliteTable('streams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: text('media_id')
    .notNull()
    .references(() => media.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  type: text('type', { enum: ['video', 'audio', 'subtitle'] }).notNull(),
  codec: text('codec').notNull(),
  width: integer('width'),
  height: integer('height'),
  language: text('language'),
});
