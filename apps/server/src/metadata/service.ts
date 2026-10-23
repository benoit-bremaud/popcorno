import type { EnrichReport, EnrichTitle, Library } from '@popcorno/shared';
import { BACKDROP_SIZE, POSTER_SIZE } from './artwork-cache.js';
import type { ArtworkCache } from './artwork-cache.js';
import { pickMatch, toEpisodeInput, toMetadataInput } from './matcher.js';
import type { MetadataInput } from './matcher.js';
import type { EpisodeRow, MetadataRepository, PendingTitle } from './repository.js';
import { TmdbRequestError } from './tmdb-client.js';
import type { TmdbClient, TmdbKind } from './tmdb-client.js';

/** Thrown when an enrichment of the same library is already in flight (spec extension 2b). */
export class EnrichRunningError extends Error {
  constructor(libraryId: string) {
    super(`An enrichment of library ${libraryId} is already running`);
    this.name = 'EnrichRunningError';
  }
}

/** Options of one run; `refresh` re-fetches every title (default false). */
export interface EnrichOptions {
  readonly refresh?: boolean;
}

type Outcome = 'matched' | 'unmatched' | 'failed';

/** UC2 — one title at a time (sequence diagram 02-sequence-enrich-metadata). */
export class MetadataService {
  private readonly running = new Set<string>();

  constructor(
    private readonly repository: MetadataRepository,
    private readonly client: TmdbClient,
    private readonly artwork: ArtworkCache,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Looks up every pending title of the library and returns the report. Per-title
   * failures are reported, never thrown.
   * @throws {EnrichRunningError} when a run on the same library is in flight.
   */
  async enrich(library: Library, options: EnrichOptions = {}): Promise<EnrichReport> {
    if (this.running.has(library.id)) throw new EnrichRunningError(library.id);
    this.running.add(library.id);
    try {
      return await this.run(library, options.refresh ?? false);
    } finally {
      this.running.delete(library.id);
    }
  }

  private async run(library: Library, refresh: boolean): Promise<EnrichReport> {
    const kind: TmdbKind = library.kind === 'films' ? 'movie' : 'tv';
    const skipped = refresh ? 0 : this.repository.countLookedUp(library.id);
    const pending = this.repository.listPending(library.id, refresh);
    const report = { matched: 0, unmatched: [] as EnrichTitle[], failed: [] as EnrichTitle[] };
    // Sequential on purpose: one request in flight keeps far under TMDB's rate limit.
    await pending.reduce(
      (previous, title) =>
        previous.then(async () => {
          const outcome = await this.enrichTitle(kind, title);
          if (outcome === 'matched') report.matched += 1;
          else report[outcome].push({ title: title.title, year: title.year });
        }),
      Promise.resolve(),
    );
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
      return 'failed';
    }
  }

  /** Spec step 4: tag id, IMDb lookup, or search with the year then without (±1). */
  private async resolveId(kind: TmdbKind, title: PendingTitle): Promise<number | null> {
    const tagged = Number.parseInt(title.providerIds.tmdb ?? '', 10);
    if (!Number.isNaN(tagged)) return tagged;
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
      this.artwork.cache(input.posterPath, POSTER_SIZE),
      this.artwork.cache(input.backdropPath, BACKDROP_SIZE),
    ]);
    return { ...input, posterPath, backdropPath };
  }

  /** Spec step 8: one season request per season present in the library. */
  private async enrichEpisodes(seriesRowId: string, tmdbId: number): Promise<void> {
    const bySeason = new Map<number, EpisodeRow[]>();
    for (const row of this.repository.listEpisodes(seriesRowId)) {
      if (row.season === null || row.episode === null) continue;
      bySeason.set(row.season, [...(bySeason.get(row.season) ?? []), row]);
    }
    await [...bySeason.entries()].reduce(
      (previous, [season, rows]) => previous.then(() => this.enrichSeason(tmdbId, season, rows)),
      Promise.resolve(),
    );
  }

  private async enrichSeason(
    tmdbId: number,
    season: number,
    rows: readonly EpisodeRow[],
  ): Promise<void> {
    let episodes: Awaited<ReturnType<TmdbClient['season']>>;
    try {
      episodes = await this.client.season(tmdbId, season);
    } catch {
      return; // Spec 8a: the episodes keep their parsed fields, the series stays matched.
    }
    const fetchedAt = this.now().toISOString();
    const inputs = await Promise.all(
      rows.map(async (row): Promise<[string, MetadataInput | null]> => {
        const episode = episodes.find((candidate) => candidate.episode_number === row.episode);
        if (!episode) return [row.id, null];
        const input = toEpisodeInput(episode, { tmdbId }, row.title);
        const still = await this.artwork.cache(input.posterPath, POSTER_SIZE);
        return [row.id, { ...input, posterPath: still }];
      }),
    );
    for (const [id, input] of inputs) {
      // Spec 8b: an episode absent from the payload is marked looked-up, fields kept.
      if (input) this.repository.saveMetadata(id, input, fetchedAt);
      else this.repository.markUnmatched(id, fetchedAt);
    }
  }
}
