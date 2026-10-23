import { alias } from 'drizzle-orm/sqlite-core';
import { and, count, eq, exists, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { MediaKind, ProviderIds } from '@popcorno/shared';
import type { AppDatabase } from '../db/index.js';
import { media } from '../db/schema.js';
import type { MetadataInput } from './matcher.js';

/** A row UC2 still has to look up: what the matcher needs and nothing else. */
export interface PendingTitle {
  readonly id: string;
  readonly kind: MediaKind;
  /** The parsed title (`parsedTitle`): the search key, never TMDB's display title. */
  readonly title: string;
  readonly year: number | null;
  readonly providerIds: ProviderIds;
  /**
   * The match kept from a previous lookup when the row is only revisited for new episodes
   * (non-refresh run); null when the row was never looked up, reset by a rescan, or refreshed.
   */
  readonly knownTmdbId: number | null;
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

const episodes = alias(media, 'episodes');

/** SQLite access of the metadata domain: pending rows, episodes and the metadata columns. */
export class MetadataRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Titles of the library still to look up, in insertion order: never looked up, or a
   * *matched* series with an episode never looked up (added by a later scan; an unmatched
   * series stays skipped until `refresh`, spec 6a); every title when `refresh`.
   */
  listPending(libraryId: string, refresh: boolean): PendingTitle[] {
    const scope = and(eq(media.libraryId, libraryId), inArray(media.kind, TITLE_KINDS));
    const hasPendingEpisode = exists(
      this.db
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.seriesId, media.id),
            eq(episodes.kind, 'episode'),
            isNull(episodes.metadataFetchedAt),
          ),
        ),
    );
    const rows = this.db
      .select({
        id: media.id,
        kind: media.kind,
        title: media.parsedTitle,
        year: media.year,
        providerIds: media.providerIds,
        tmdbId: media.tmdbId,
        fetchedAt: media.metadataFetchedAt,
      })
      .from(media)
      .where(
        refresh
          ? scope
          : and(
              scope,
              or(isNull(media.metadataFetchedAt), and(isNotNull(media.tmdbId), hasPendingEpisode)),
            ),
      )
      .all();
    return rows.map(({ tmdbId, fetchedAt, ...row }) => ({
      ...row,
      knownTmdbId: !refresh && fetchedAt !== null ? tmdbId : null,
    }));
  }

  /** Titles of the library already looked up (what a non-refresh run leaves untouched). */
  countLookedUp(libraryId: string): number {
    return (
      this.db
        .select({ total: count() })
        .from(media)
        .where(
          and(
            eq(media.libraryId, libraryId),
            inArray(media.kind, TITLE_KINDS),
            isNotNull(media.metadataFetchedAt),
          ),
        )
        .get()?.total ?? 0
    );
  }

  /** Episode rows attached to a series row. */
  listEpisodes(seriesId: string): EpisodeRow[] {
    return this.db
      .select({ id: media.id, title: media.title, season: media.season, episode: media.episode })
      .from(media)
      .where(and(eq(media.seriesId, seriesId), eq(media.kind, 'episode')))
      .all();
  }

  /**
   * Writes the metadata columns of a row and replaces its `title` by the provider's
   * (`parsedTitle`, the series grouping key, is never touched); `posterPath` /
   * `backdropPath` are cached file names.
   */
  saveMetadata(id: string, input: MetadataInput, fetchedAt: string): void {
    this.db
      .update(media)
      .set({ ...input, metadataFetchedAt: fetchedAt })
      .where(eq(media.id, id))
      .run();
  }

  /** Records a lookup without touching the columns (spec 8b: an episode absent from its season). */
  markLookedUp(id: string, fetchedAt: string): void {
    this.db.update(media).set({ metadataFetchedAt: fetchedAt }).where(eq(media.id, id)).run();
  }

  /**
   * Records a lookup that found nothing: fetched, no TMDB id, other columns cleared and the
   * parsed title restored. Applied to the row *and its episodes*, so a series that loses
   * its match (refresh, corrected tag answering 404) leaves no stale episode data behind.
   */
  markUnmatched(id: string, fetchedAt: string): void {
    this.db
      .update(media)
      .set({
        title: sql`${media.parsedTitle}`,
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
      .where(or(eq(media.id, id), eq(media.seriesId, id)))
      .run();
  }
}
