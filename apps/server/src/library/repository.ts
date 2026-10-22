import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import type { CreateLibraryBody, Library, Media, ProviderIds, StreamInfo } from '@popcorno/shared';
import type { AppDatabase } from '../db/index.js';
import { libraries, media, streams } from '../db/schema.js';

/** A `media` row to write; the scanner fills it from the parser and the prober. */
export interface MediaInput {
  readonly kind: Media['kind'];
  readonly title: string;
  readonly year: number | null;
  readonly filePath: string | null;
  readonly fileSize: number | null;
  readonly fileMtimeMs: number | null;
  readonly durationSec: number | null;
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeEnd: number | null;
  readonly seriesId: string | null;
  readonly providerIds: ProviderIds;
  readonly edition: string | null;
  readonly part: number | null;
}

/** File fingerprint used to skip probing unchanged files (spec extension 7b). */
export interface StoredFile {
  readonly id: string;
  readonly fileSize: number | null;
  readonly fileMtimeMs: number | null;
}

/** SQLite access for the library domain (component diagram: "SQLite repositories"). */
export class LibraryRepository {
  constructor(private readonly db: AppDatabase) {}

  createLibrary(input: CreateLibraryBody): Library {
    const row = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    this.db.insert(libraries).values(row).run();
    return { id: row.id, name: row.name, rootPath: row.rootPath, kind: row.kind };
  }

  listLibraries(): Library[] {
    return this.db
      .select({
        id: libraries.id,
        name: libraries.name,
        rootPath: libraries.rootPath,
        kind: libraries.kind,
      })
      .from(libraries)
      .all();
  }

  findLibrary(id: string): Library | null {
    return (
      this.db
        .select({
          id: libraries.id,
          name: libraries.name,
          rootPath: libraries.rootPath,
          kind: libraries.kind,
        })
        .from(libraries)
        .where(eq(libraries.id, id))
        .get() ?? null
    );
  }

  findStoredFile(libraryId: string, filePath: string): StoredFile | null {
    return (
      this.db
        .select({ id: media.id, fileSize: media.fileSize, fileMtimeMs: media.fileMtimeMs })
        .from(media)
        .where(and(eq(media.libraryId, libraryId), eq(media.filePath, filePath)))
        .get() ?? null
    );
  }

  /** Finds the `series` row of a library by title, creating it on demand. */
  findOrCreateSeries(
    libraryId: string,
    title: string,
    year: number | null,
    providerIds: ProviderIds,
  ): string {
    const existing = this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.libraryId, libraryId), eq(media.kind, 'series'), eq(media.title, title)))
      .get();
    if (existing) return existing.id;
    const id = randomUUID();
    this.db
      .insert(media)
      .values({
        id,
        libraryId,
        kind: 'series',
        title,
        year,
        providerIds: JSON.stringify(providerIds),
      })
      .run();
    return id;
  }

  /** Inserts or replaces the row keyed by `(libraryId, filePath)` and its streams; returns the media id. */
  upsertMedia(libraryId: string, input: MediaInput, fileStreams: readonly StreamInfo[]): string {
    const id = randomUUID();
    const values = { ...input, libraryId, providerIds: JSON.stringify(input.providerIds) };
    return this.db.transaction((tx) => {
      const inserted = tx
        .insert(media)
        .values({ id, ...values })
        .onConflictDoUpdate({ target: [media.libraryId, media.filePath], set: values })
        .returning({ id: media.id })
        .get();
      const mediaId = inserted?.id ?? id;
      tx.delete(streams).where(eq(streams.mediaId, mediaId)).run();
      if (fileStreams.length > 0) {
        tx.insert(streams)
          .values(fileStreams.map((stream, position) => ({ ...stream, mediaId, position })))
          .run();
      }
      return mediaId;
    });
  }

  /** Removes file-backed rows of the library not seen by the scan, then orphan series rows. */
  deleteMissing(libraryId: string, seenPaths: readonly string[]): number {
    const gone = this.db
      .delete(media)
      .where(
        and(
          eq(media.libraryId, libraryId),
          isNotNull(media.filePath),
          seenPaths.length > 0 ? notInArray(media.filePath, [...seenPaths]) : undefined,
        ),
      )
      .returning({ id: media.id })
      .all();
    const liveSeries = this.db
      .selectDistinct({ seriesId: media.seriesId })
      .from(media)
      .where(and(eq(media.libraryId, libraryId), isNotNull(media.seriesId)))
      .all()
      .flatMap((row) => (row.seriesId === null ? [] : [row.seriesId]));
    this.db
      .delete(media)
      .where(
        and(
          eq(media.libraryId, libraryId),
          eq(media.kind, 'series'),
          liveSeries.length > 0 ? notInArray(media.id, liveSeries) : undefined,
        ),
      )
      .run();
    return gone.length;
  }

  listMedia(libraryId: string): Media[] {
    const rows = this.db.select().from(media).where(eq(media.libraryId, libraryId)).all();
    const ids = rows.map((row) => row.id);
    const streamRows =
      ids.length > 0
        ? this.db
            .select()
            .from(streams)
            .where(inArray(streams.mediaId, ids))
            .orderBy(streams.position)
            .all()
        : [];
    return rows.map((row) => ({
      id: row.id,
      libraryId: row.libraryId,
      kind: row.kind,
      title: row.title,
      year: row.year,
      filePath: row.filePath,
      durationSec: row.durationSec,
      season: row.season,
      episode: row.episode,
      episodeEnd: row.episodeEnd,
      seriesId: row.seriesId,
      providerIds: JSON.parse(row.providerIds) as ProviderIds,
      edition: row.edition,
      part: row.part,
      streams: streamRows
        .filter((stream) => stream.mediaId === row.id)
        .map(({ type, codec, width, height, language }) => ({
          type,
          codec,
          width,
          height,
          language,
        })),
    }));
  }
}
