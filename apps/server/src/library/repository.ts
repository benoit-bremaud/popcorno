import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type {
  CastMember,
  CreateLibraryBody,
  Genre,
  Library,
  Media,
  MediaMetadata,
  ProviderIds,
  StreamInfo,
} from '@popcorntv/shared';
import type { AppDatabase } from '../db/index.js';
import { libraries, media, streams } from '../db/schema.js';
import type { ParsedName } from './name-parser.js';

/** A file-backed `media` row to write: the parsed name plus what the scanner and prober add. */
export type MediaInput = ParsedName & {
  /** Real absolute path (symlinks resolved), the upsert key with the library id. */
  readonly filePath: string;
  readonly relativePath: string;
  readonly fileSize: number;
  readonly fileMtimeMs: number;
  readonly durationSec: number | null;
  readonly seriesId: string | null;
};

/** File fingerprint used to skip probing unchanged files (spec extension 7b). */
export interface StoredFile {
  readonly id: string;
  readonly fileSize: number | null;
  readonly fileMtimeMs: number | null;
  readonly relativePath: string | null;
}

/** SQLite binds at most 32 766 variables per statement; ids are deleted in chunks. */
const DELETE_CHUNK = 500;

function sameProviderIds(a: ProviderIds, b: ProviderIds): boolean {
  return a.tmdb === b.tmdb && a.imdb === b.imdb;
}

const libraryColumns = {
  id: libraries.id,
  name: libraries.name,
  rootPath: libraries.rootPath,
  kind: libraries.kind,
};

/** SQLite access for the library domain (component diagram: "SQLite repositories"). */
export class LibraryRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Inserts a library with a fresh id; the caller has already validated the root. */
  createLibrary(input: CreateLibraryBody): Library {
    const row = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    this.db.insert(libraries).values(row).run();
    return { id: row.id, name: row.name, rootPath: row.rootPath, kind: row.kind };
  }

  /** Every library, in insertion order. */
  listLibraries(): Library[] {
    return this.db.select(libraryColumns).from(libraries).all();
  }

  /** The library with this id, or null. */
  findLibrary(id: string): Library | null {
    return this.db.select(libraryColumns).from(libraries).where(eq(libraries.id, id)).get() ?? null;
  }

  /** The stored fingerprint of a file (by real path), or null when never scanned. */
  findStoredFile(libraryId: string, filePath: string): StoredFile | null {
    return (
      this.db
        .select({
          id: media.id,
          fileSize: media.fileSize,
          fileMtimeMs: media.fileMtimeMs,
          relativePath: media.relativePath,
        })
        .from(media)
        .where(and(eq(media.libraryId, libraryId), eq(media.filePath, filePath)))
        .get() ?? null
    );
  }

  /**
   * Finds the `series` row of a library by parsed title and year, creating it on demand.
   * The lookup uses `parsedTitle`, never `title`: TMDB may rename the series (ADR-0003) and
   * a later episode must still join it. A tag parsed from the new episode's name that
   * differs from the stored one wins (the owner's way to correct a wrong match) and queues
   * the series for a new lookup.
   */
  findOrCreateSeries(
    libraryId: string,
    parsedTitle: string,
    year: number | null,
    providerIds: ProviderIds,
  ): string {
    const existing = this.db
      .select({ id: media.id, providerIds: media.providerIds })
      .from(media)
      .where(
        and(
          eq(media.libraryId, libraryId),
          eq(media.kind, 'series'),
          eq(media.parsedTitle, parsedTitle),
          year === null ? isNull(media.year) : eq(media.year, year),
        ),
      )
      .get();
    if (existing) {
      const tagged = Object.keys(providerIds).length > 0;
      if (tagged && !sameProviderIds(existing.providerIds, providerIds)) {
        this.db
          .update(media)
          .set({ providerIds, metadataFetchedAt: null })
          .where(eq(media.id, existing.id))
          .run();
      }
      return existing.id;
    }
    const id = randomUUID();
    this.db
      .insert(media)
      .values({ id, libraryId, kind: 'series', title: parsedTitle, parsedTitle, year, providerIds })
      .run();
    return id;
  }

  /** Inserts or replaces the row keyed by `(libraryId, filePath)` and its streams; returns the media id. */
  upsertMedia(libraryId: string, input: MediaInput, fileStreams: readonly StreamInfo[]): string {
    const id = randomUUID();
    const values = { ...input, libraryId, parsedTitle: input.title };
    return this.db.transaction((tx) => {
      const inserted = tx
        .insert(media)
        .values({ id, ...values })
        // A file the scan found changed may carry a new title, year or tag: look it up again.
        .onConflictDoUpdate({
          target: [media.libraryId, media.filePath],
          set: { ...values, metadataFetchedAt: null },
        })
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

  /**
   * Removes the file-backed rows of the library whose real path is not in `seenPaths`,
   * then the series rows no episode points to. The diff runs in JS so a library of any
   * size stays under SQLite's bind-variable limit. Returns the number of files removed.
   */
  deleteMissing(libraryId: string, seenPaths: ReadonlySet<string>): number {
    const stored = this.db
      .select({ id: media.id, filePath: media.filePath })
      .from(media)
      .where(and(eq(media.libraryId, libraryId), isNotNull(media.filePath)))
      .all();
    const missing = stored.flatMap((row) =>
      row.filePath !== null && !seenPaths.has(row.filePath) ? [row.id] : [],
    );
    this.db.transaction((tx) => {
      for (let i = 0; i < missing.length; i += DELETE_CHUNK) {
        tx.delete(media)
          .where(inArray(media.id, missing.slice(i, i + DELETE_CHUNK)))
          .run();
      }
      const episodes = alias(media, 'episodes');
      tx.delete(media)
        .where(
          and(
            eq(media.libraryId, libraryId),
            eq(media.kind, 'series'),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(episodes)
                .where(eq(episodes.seriesId, media.id)),
            ),
          ),
        )
        .run();
    });
    return missing.length;
  }

  /**
   * The stored real path of a file-backed media row and its library root, or null for an
   * unknown id or a `series` row (no file). Playback re-checks both against the disk.
   */
  findMediaFile(id: string): {
    readonly filePath: string;
    readonly rootPath: string;
    readonly durationSec: number | null;
  } | null {
    const row = this.db
      .select({
        filePath: media.filePath,
        rootPath: libraries.rootPath,
        durationSec: media.durationSec,
      })
      .from(media)
      .innerJoin(libraries, eq(libraries.id, media.libraryId))
      .where(eq(media.id, id))
      .get();
    return row?.filePath
      ? { filePath: row.filePath, rootPath: row.rootPath, durationSec: row.durationSec }
      : null;
  }

  /** The streams of one media row in scan order (empty for an unknown id). */
  findMediaStreams(id: string): StreamInfo[] {
    return this.db
      .select({
        type: streams.type,
        codec: streams.codec,
        width: streams.width,
        height: streams.height,
        language: streams.language,
      })
      .from(streams)
      .where(eq(streams.mediaId, id))
      .orderBy(streams.position)
      .all();
  }

  /** Every media row of the library with its streams, in insertion order. */
  listMedia(libraryId: string): Media[] {
    const rows = this.db
      .select({
        id: media.id,
        libraryId: media.libraryId,
        kind: media.kind,
        title: media.title,
        year: media.year,
        relativePath: media.relativePath,
        durationSec: media.durationSec,
        season: media.season,
        episode: media.episode,
        episodeEnd: media.episodeEnd,
        seriesId: media.seriesId,
        providerIds: media.providerIds,
        edition: media.edition,
        part: media.part,
        tmdbId: media.tmdbId,
        overview: media.overview,
        genres: media.genres,
        releaseDate: media.releaseDate,
        runtimeMin: media.runtimeMin,
        voteAverage: media.voteAverage,
        voteCount: media.voteCount,
        cast: media.cast,
        posterPath: media.posterPath,
        backdropPath: media.backdropPath,
        metadataFetchedAt: media.metadataFetchedAt,
      })
      .from(media)
      .where(eq(media.libraryId, libraryId))
      .all();
    const streamsByMedia = new Map<string, StreamInfo[]>();
    const streamRows = this.db
      .select({
        mediaId: streams.mediaId,
        type: streams.type,
        codec: streams.codec,
        width: streams.width,
        height: streams.height,
        language: streams.language,
      })
      .from(streams)
      .innerJoin(media, eq(media.id, streams.mediaId))
      .where(eq(media.libraryId, libraryId))
      .orderBy(streams.position)
      .all();
    for (const { mediaId, ...stream } of streamRows) {
      const list = streamsByMedia.get(mediaId) ?? [];
      list.push(stream);
      streamsByMedia.set(mediaId, list);
    }
    return rows.map((row) => toMedia(row, streamsByMedia.get(row.id) ?? []));
  }
}

type MediaRow = Omit<Media, 'streams' | 'metadata'> & {
  readonly tmdbId: number | null;
  readonly overview: string | null;
  readonly genres: readonly Genre[] | null;
  readonly releaseDate: string | null;
  readonly runtimeMin: number | null;
  readonly voteAverage: number | null;
  readonly voteCount: number | null;
  readonly cast: readonly CastMember[] | null;
  readonly posterPath: string | null;
  readonly backdropPath: string | null;
  readonly metadataFetchedAt: string | null;
};

/** Folds the flat metadata columns into `Media.metadata` (null until UC2 looked the row up). */
function toMedia(row: MediaRow, mediaStreams: readonly StreamInfo[]): Media {
  const { metadataFetchedAt, genres, cast, ...rest } = row;
  const {
    tmdbId,
    overview,
    releaseDate,
    runtimeMin,
    voteAverage,
    voteCount,
    posterPath,
    backdropPath,
    ...base
  } = rest;
  const metadata: MediaMetadata | null =
    metadataFetchedAt === null
      ? null
      : {
          tmdbId,
          overview,
          genres: genres ?? [],
          releaseDate,
          runtimeMin,
          voteAverage,
          voteCount,
          cast: cast ?? [],
          posterPath,
          backdropPath,
          fetchedAt: metadataFetchedAt,
        };
  return { ...base, streams: mediaStreams, metadata };
}
