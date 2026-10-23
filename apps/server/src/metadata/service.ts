import type { EnrichReport, EnrichTitle, Library } from '@popcorno/shared';
import { BACKDROP_SIZE, POSTER_SIZE } from './artwork-cache.js';
import type { ArtworkCache } from './artwork-cache.js';
import { pickMatch, toEpisodeInput, toMetadataInput } from './matcher.js';
import type { MetadataInput } from './matcher.js';
import type { EpisodeRow, MetadataRepository, PendingTitle } from './repository.js';
import { TmdbRequestError } from './tmdb-client.js';
import type { TmdbClient, TmdbEpisode, TmdbKind } from './tmdb-client.js';

/** Options of one run; `refresh` re-fetches every title (default false). */
export interface EnrichOptions {
  readonly refresh?: boolean;
}

/** Where per-title failures go: the report only names the title, the log keeps the cause. */
export interface EnrichLogger {
  warn(error: unknown, message: string): void;
}

/** Collaborators of the service; `now` and `logger` are the boundaries tests replace. */
export interface MetadataServiceDeps {
  readonly repository: MetadataRepository;
  readonly client: TmdbClient;
  readonly artwork: ArtworkCache;
  readonly logger?: EnrichLogger;
  readonly now?: () => Date;
}

type Outcome = 'matched' | 'unmatched' | 'failed';

/**
 * Runs `step` on each item one after the other. Sequential on purpose: a single request
 * in flight keeps far under TMDB's rate limit (ADR-0003 § 5). Recursion rather than a loop
 * so neither `await`-in-loop (Sonar S9382) nor a `.then()` chain is needed.
 */
async function sequentially<T>(
  items: readonly T[],
  step: (item: T) => Promise<void>,
  index = 0,
): Promise<void> {
  const item = items[index];
  if (index >= items.length || item === undefined) return;
  await step(item);
  return sequentially(items, step, index + 1);
}

/** A tag must be a whole TMDB id; `12abc` is a typo, not id 12. */
const TMDB_ID = /^\d{1,12}$/;

/** UC2 — one title at a time (sequence diagram 02-sequence-enrich-metadata). */
export class MetadataService {
  private readonly repository: MetadataRepository;
  private readonly client: TmdbClient;
  private readonly artwork: ArtworkCache;
  private readonly logger: EnrichLogger;
  private readonly now: () => Date;

  constructor(deps: MetadataServiceDeps) {
    this.repository = deps.repository;
    this.client = deps.client;
    this.artwork = deps.artwork;
    this.logger = deps.logger ?? { warn: () => {} };
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Looks up every pending title of the library and returns the report. Per-title
   * failures are reported and logged, never thrown. Not guarded against a concurrent
   * run: the routes hold the `LibraryLock` (spec 2b), shared with the scan.
   */
  async enrich(library: Library, options: EnrichOptions = {}): Promise<EnrichReport> {
    const refresh = options.refresh ?? false;
    const kind: TmdbKind = library.kind === 'films' ? 'movie' : 'tv';
    const skipped = refresh ? 0 : this.repository.countLookedUp(library.id);
    const pending = this.repository.listPending(library.id, refresh);
    const report = { matched: 0, unmatched: [] as EnrichTitle[], failed: [] as EnrichTitle[] };
    await sequentially(pending, async (title) => {
      const outcome = await this.enrichTitle(kind, title);
      if (outcome === 'matched') report.matched += 1;
      else report[outcome].push({ title: title.title, year: title.year });
    });
    return { ...report, skipped };
  }

  private async enrichTitle(kind: TmdbKind, title: PendingTitle): Promise<Outcome> {
    try {
      const id = await this.resolveId(kind, title);
      if (id === null) {
        this.repository.markUnmatched(title.id, this.now().toISOString());
        return 'unmatched';
      }
      const details = await this.client.details(kind, id);
      const input = await this.withArtwork(toMetadataInput(details));
      this.repository.saveMetadata(title.id, input, this.now().toISOString());
      if (kind === 'tv') await this.enrichEpisodes(title.id, input.tmdbId);
      return 'matched';
    } catch (error) {
      // A provider id TMDB does not know is "unmatched" (spec 4b); anything else failed (5a).
      if (error instanceof TmdbRequestError && error.status === 404 && title.providerIds.tmdb) {
        this.repository.markUnmatched(title.id, this.now().toISOString());
        return 'unmatched';
      }
      this.logger.warn(error, `metadata lookup failed for "${title.title}"`);
      return 'failed';
    }
  }

  /** Spec step 4: tag id, IMDb lookup, or search with the year then without (±1). */
  private async resolveId(kind: TmdbKind, title: PendingTitle): Promise<number | null> {
    const tag = title.providerIds.tmdb ?? '';
    if (TMDB_ID.test(tag)) return Number.parseInt(tag, 10);
    if (title.providerIds.imdb) {
      return (
        pickMatch(await this.client.findByImdb(kind, title.providerIds.imdb), null)?.id ?? null
      );
    }
    if (title.year !== null) {
      const exact = pickMatch(await this.client.search(kind, title.title, title.year), title.year);
      if (exact) return exact.id;
    }
    const loose = await this.client.search(kind, title.title, null);
    return pickMatch(loose, title.year, 1)?.id ?? null;
  }

  /** Replaces the TMDB artwork paths by cached file names (null when absent or failed). */
  private async withArtwork(input: MetadataInput): Promise<MetadataInput> {
    const [posterPath, backdropPath] = await Promise.all([
      this.cacheArtwork(input.posterPath, POSTER_SIZE),
      this.cacheArtwork(input.backdropPath, BACKDROP_SIZE),
    ]);
    return { ...input, posterPath, backdropPath };
  }

  private cacheArtwork(path: string | null, size: string): Promise<string | null> {
    return this.artwork.cache(path, size, (error) =>
      this.logger.warn(error, `artwork download failed for ${size}${path}`),
    );
  }

  /** Spec step 8: one season request per season present in the library. */
  private async enrichEpisodes(seriesRowId: string, tmdbId: number): Promise<void> {
    const bySeason = new Map<number, EpisodeRow[]>();
    for (const row of this.repository.listEpisodes(seriesRowId)) {
      if (row.season === null || row.episode === null) continue;
      bySeason.set(row.season, [...(bySeason.get(row.season) ?? []), row]);
    }
    await sequentially([...bySeason], ([season, rows]) => this.enrichSeason(tmdbId, season, rows));
  }

  private async enrichSeason(
    tmdbId: number,
    season: number,
    rows: readonly EpisodeRow[],
  ): Promise<void> {
    let episodes: readonly TmdbEpisode[];
    try {
      episodes = await this.client.season(tmdbId, season);
    } catch (error) {
      // Spec 8a: the episodes keep their parsed fields, the series stays matched.
      this.logger.warn(error, `season ${season} of TMDB ${tmdbId} could not be fetched`);
      return;
    }
    const fetchedAt = this.now().toISOString();
    const inputs = await Promise.all(
      rows.map(async (row): Promise<[string, MetadataInput | null]> => {
        const episode = episodes.find((candidate) => candidate.episode_number === row.episode);
        if (!episode) return [row.id, null];
        const input = toEpisodeInput(episode, { tmdbId }, row.title);
        const still = await this.cacheArtwork(input.posterPath, POSTER_SIZE);
        return [row.id, { ...input, posterPath: still }];
      }),
    );
    for (const [id, input] of inputs) {
      // Spec 8b: an episode absent from the payload is marked looked-up, its fields kept.
      if (input) this.repository.saveMetadata(id, input, fetchedAt);
      else this.repository.markLookedUp(id, fetchedAt);
    }
  }
}
