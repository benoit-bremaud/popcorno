/** Contracts shared by the server and the web player. */

/** Response of `GET /health` — liveness only, never depends on the database or FFmpeg. */
export interface HealthResponse {
  readonly status: 'ok';
  readonly version: string;
}

/** What a library folder contains; drives the name parser (ADR-0002). */
export type LibraryKind = 'films' | 'series';

/** A media folder registered by the owner (UC1). */
export interface Library {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly kind: LibraryKind;
}

/** Body of `POST /libraries`. */
export interface CreateLibraryBody {
  readonly name: string;
  readonly rootPath: string;
  readonly kind: LibraryKind;
}

/**
 * What a file turned out to be. `series` rows have no file of their own and group the
 * episodes; `unknown` is a playable file whose name matched no convention (spec 5a).
 */
export type MediaKind = 'film' | 'episode' | 'series' | 'unknown';

export type StreamType = 'video' | 'audio' | 'subtitle';

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

/** A film, an episode, a series or an unresolved file of a library (class diagram 04). */
export interface Media {
  readonly id: string;
  readonly libraryId: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year: number | null;
  /** Absolute path; null for a `series` row. Always resolves under the library root. */
  readonly filePath: string | null;
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
}

/** Why a file was left out of the library during a scan (spec extensions). */
export type SkipReason = 'unreadable' | 'outside_root' | 'probe_failed' | 'extra';

export interface SkippedFile {
  readonly path: string;
  readonly reason: SkipReason;
}

/** Response of `POST /libraries/:id/scan`. */
export interface ScanReport {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly skipped: readonly SkippedFile[];
}

/** Error body of every non-2xx response. */
export interface ApiError {
  readonly error: string;
  readonly details?: unknown;
}
