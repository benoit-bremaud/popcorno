import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { MediaKind, ProviderIds } from '@popcorno/shared';
import type { AppDatabase } from '../db/index.js';
import { media } from '../db/schema.js';
import type { MetadataInput } from './matcher.js';

/** A row UC2 still has to look up: what the matcher needs and nothing else. */
export interface PendingTitle {
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year: number | null;
  readonly providerIds: ProviderIds;
}

/** An episode row of a series, located by its parsed season and number. */
export interface EpisodeRow {
  readonly id: string;
  readonly title: string;
  readonly season: number | null;
  readonly episode: number | null;
}

/** Rows UC2 looks up directly; episodes go through their series (spec step 8). */
const TITLE_KINDS: readonly MediaKind[] = ['film', 'series', 'unknown'];

/** SQLite access of the metadata domain: pending rows, episodes and the metadata columns. */
export class MetadataRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Titles of the library never looked up (every title when `refresh`), in insertion order. */
  listPending(libraryId: string, refresh: boolean): PendingTitle[] {
    const scope = and(eq(media.libraryId, libraryId), inArray(media.kind, TITLE_KINDS));
    return this.db
      .select({
        id: media.id,
        kind: media.kind,
        title: media.title,
        year: media.year,
        providerIds: media.providerIds,
      })
      .from(media)
      .where(refresh ? scope : and(scope, isNull(media.metadataFetchedAt)))
      .all();
  }

  /** Titles of the library already looked up (what a non-refresh run leaves untouched). */
  countLookedUp(libraryId: string): number {
    return this.db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.libraryId, libraryId),
          inArray(media.kind, TITLE_KINDS),
          isNotNull(media.metadataFetchedAt),
        ),
      )
      .all().length;
  }

  /** Episode rows attached to a series row. */
  listEpisodes(seriesId: string): EpisodeRow[] {
    return this.db
      .select({ id: media.id, title: media.title, season: media.season, episode: media.episode })
      .from(media)
      .where(and(eq(media.seriesId, seriesId), eq(media.kind, 'episode')))
      .all();
  }

  /** Writes the metadata columns of a row; `posterPath` / `backdropPath` are cached file names. */
  saveMetadata(id: string, input: MetadataInput, fetchedAt: string): void {
    this.db
      .update(media)
      .set({ ...input, metadataFetchedAt: fetchedAt })
      .where(eq(media.id, id))
      .run();
  }

  /** Records a lookup that found nothing: fetched, no TMDB id, other columns cleared. */
  markUnmatched(id: string, fetchedAt: string): void {
    this.db
      .update(media)
      .set({
        tmdbId: null,
        overview: null,
        genres: null,
        releaseDate: null,
        runtimeMin: null,
        voteAverage: null,
        voteCount: null,
        cast: null,
        posterPath: null,
        backdropPath: null,
        metadataFetchedAt: fetchedAt,
      })
      .where(eq(media.id, id))
      .run();
  }
}
