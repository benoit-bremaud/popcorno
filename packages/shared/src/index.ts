/** Contracts shared by the server and the web player. */

/** Response of `GET /health` — liveness only, never depends on the database or FFmpeg. */
export interface HealthResponse {
  readonly status: 'ok';
  readonly version: string;
}

/** Library kinds, single source for the zod schema and the SQLite enum. */
export const LIBRARY_KINDS = ['films', 'series'] as const;

/** What a library folder contains; drives the name parser (ADR-0002). */
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** A media folder registered by the owner (UC1). */
export interface Library {
  readonly id: string;
  readonly name: string;
  /** Absolute path, always under the server's `MEDIA_ROOT`. */
  readonly rootPath: string;
  readonly kind: LibraryKind;
}

/** Body of `POST /libraries`. */
export type CreateLibraryBody = Omit<Library, 'id'>;

/** Media kinds, single source for the SQLite enum. */
export const MEDIA_KINDS = ['film', 'episode', 'series', 'unknown'] as const;

/**
 * What a file turned out to be. `series` rows have no file of their own and group the
 * episodes; `unknown` is a playable file whose name matched no convention (spec 5a).
 */
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Stream types the scanner keeps from ffprobe (attachments and data streams are dropped). */
export const STREAM_TYPES = ['video', 'audio', 'subtitle'] as const;

/** Kind of a technical stream of a file. */
export type StreamType = (typeof STREAM_TYPES)[number];

/** One technical stream of a file, as reported by ffprobe. */
export interface StreamInfo {
  readonly type: StreamType;
  readonly codec: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly language: string | null;
}

/** Provider identifiers read from the file name, e.g. `[tmdbid-603]` → `{ tmdb: '603' }`. */
export interface ProviderIds {
  readonly tmdb?: string;
  readonly imdb?: string;
}

/** A TMDB genre; id 99 is `Documentary` for both films and series. */
export interface Genre {
  readonly id: number;
  readonly name: string;
}

/** TMDB genre id of documentaries; the catalog derives its "documentaries" row from it. */
export const DOCUMENTARY_GENRE_ID = 99;

/** One billed cast member (top 10 by TMDB order). `profilePath` is the TMDB path, not cached. */
export interface CastMember {
  readonly name: string;
  readonly character: string;
  readonly profilePath: string | null;
}

/**
 * What UC2 fetched from TMDB for a title (ADR-0003). Present once TMDB was asked;
 * `tmdbId` null means "looked up, unmatched". `posterPath` / `backdropPath` are cached
 * file names served by `GET /artwork/:file` (an episode's `posterPath` is its still).
 */
export interface MediaMetadata {
  readonly tmdbId: number | null;
  readonly overview: string | null;
  readonly genres: readonly Genre[];
  /** ISO date (`YYYY-MM-DD`): release date, first air date or episode air date. */
  readonly releaseDate: string | null;
  readonly runtimeMin: number | null;
  readonly voteAverage: number | null;
  readonly voteCount: number | null;
  readonly cast: readonly CastMember[];
  readonly posterPath: string | null;
  readonly backdropPath: string | null;
  /** ISO timestamp of the lookup. */
  readonly fetchedAt: string;
}

/** True when the title carries TMDB's documentary genre (class diagram `isDocumentary()`). */
export function isDocumentary(metadata: Pick<MediaMetadata, 'genres'>): boolean {
  return metadata.genres.some((genre) => genre.id === DOCUMENTARY_GENRE_ID);
}

/** A film, an episode, a series or an unresolved file of a library (class diagram 04). */
export interface Media {
  readonly id: string;
  readonly libraryId: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year: number | null;
  /** Path relative to the library root, `/`-separated; null for a `series` row. */
  readonly relativePath: string | null;
  readonly durationSec: number | null;
  readonly season: number | null;
  readonly episode: number | null;
  /** Last episode of a multi-episode file (`S01E02-E03` → 3), else null. */
  readonly episodeEnd: number | null;
  readonly seriesId: string | null;
  readonly providerIds: ProviderIds;
  readonly edition: string | null;
  readonly part: number | null;
  readonly streams: readonly StreamInfo[];
  /** Null until UC2 looked the title up. */
  readonly metadata: MediaMetadata | null;
}

/** Why a file was left out of the library during a scan (spec extensions). */
export type SkipReason = 'unreadable' | 'outside_root' | 'probe_failed' | 'extra' | 'duplicate';

/** One entry of `ScanReport.skipped`: the relative path and why it was left out. */
export interface SkippedFile {
  readonly path: string;
  readonly reason: SkipReason;
}

/** A title UC2 could not resolve or fetch: what was sent to TMDB, nothing more. */
export interface EnrichTitle {
  readonly title: string;
  readonly year: number | null;
}

/** Response of `POST /libraries/:id/enrich` and the `metadata` section of a scan report. */
export interface EnrichReport {
  readonly matched: number;
  /** Titles TMDB knows nothing about; not retried until `refresh`. */
  readonly unmatched: readonly EnrichTitle[];
  /** Titles a request failed on; retried on the next run. */
  readonly failed: readonly EnrichTitle[];
  /** Rows already enriched and left untouched (always 0 with `refresh`). */
  readonly skipped: number;
}

/** Body of `POST /libraries/:id/enrich`; `refresh` re-fetches every row (default false). */
export interface EnrichBody {
  readonly refresh?: boolean;
}

/**
 * Response of `POST /libraries/:id/scan`; `metadata` is null when `TMDB_API_KEY` is not
 * set or when the post-scan enrichment could not run (e.g. one already in flight — logged).
 */
export interface ScanReport {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly skipped: readonly SkippedFile[];
  readonly metadata: EnrichReport | null;
}

/** Stable error codes of every non-2xx response. */
export type ApiErrorCode =
  | 'invalid_request'
  | 'library_not_found'
  | 'root_unreadable'
  | 'scan_running'
  | 'tmdb_not_configured'
  | 'enrich_running'
  | 'artwork_not_found'
  | 'media_not_found'
  | 'internal';

/** Error body of every non-2xx response. */
export interface ApiError {
  readonly error: ApiErrorCode;
  readonly details?: unknown;
}

export * from './playback.js';
