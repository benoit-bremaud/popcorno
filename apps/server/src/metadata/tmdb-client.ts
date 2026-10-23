import { z } from 'zod';

/**
 * TMDB v3 client — the single HTTP egress of the server (component diagram, ADR-0003).
 * `fetch` is injected so tests assert URLs and headers without opening a socket. Only a
 * title, a year or a provider id ever appear in a request (data-flow 06); the key travels
 * in the `Authorization` header and never appears in an error.
 */

/** What TMDB calls a movie or a TV series; a films library searches movies, a series library TV. */
export type TmdbKind = 'movie' | 'tv';

/** One search / find result reduced to what the matcher needs. */
export interface TmdbCandidate {
  readonly id: number;
  /** Release year (movie) or first-air year (TV), null when TMDB has no date. */
  readonly year: number | null;
}

/** A billed cast member as TMDB returns it. */
export interface TmdbCastMember {
  readonly name: string;
  readonly character: string;
  readonly profile_path: string | null;
  readonly order: number;
}

/** Movie or TV details with credits, normalised to one shape by the response schemas. */
export interface TmdbTitleDetails {
  readonly id: number;
  readonly title: string;
  readonly overview: string;
  readonly genres: readonly { readonly id: number; readonly name: string }[];
  /** `release_date` or `first_air_date`, empty when unknown. */
  readonly date: string;
  /** `runtime` (movie) or the first `episode_run_time` (TV), null when absent. */
  readonly runtimeMin: number | null;
  readonly vote_average: number;
  readonly vote_count: number;
  readonly poster_path: string | null;
  readonly backdrop_path: string | null;
  readonly cast: readonly TmdbCastMember[];
}

/** One episode of a season payload. */
export interface TmdbEpisode {
  readonly episode_number: number;
  readonly name: string;
  readonly overview: string;
  readonly still_path: string | null;
  readonly air_date: string | null;
  readonly runtime: number | null;
  readonly vote_average: number;
  readonly vote_count: number;
}

/** The five operations UC2 needs; the metadata service depends on this, tests inject a fake. */
export interface TmdbClient {
  /** `/search/movie` or `/search/tv`; `year` filters the release / first-air year when set. */
  search(kind: TmdbKind, title: string, year: number | null): Promise<readonly TmdbCandidate[]>;
  /** `/find/{imdbId}` — the movie or TV results depending on `kind`. */
  findByImdb(kind: TmdbKind, imdbId: string): Promise<readonly TmdbCandidate[]>;
  /** `/movie/{id}` or `/tv/{id}` with `append_to_response=credits`. */
  details(kind: TmdbKind, id: number): Promise<TmdbTitleDetails>;
  /** `/tv/{id}/season/{n}`. */
  season(seriesId: number, season: number): Promise<readonly TmdbEpisode[]>;
  /** Image bytes for a TMDB path (`/abc.jpg`) at a size (`w500`); base URL from `/configuration`. */
  image(path: string, size: string): Promise<Uint8Array>;
}

/**
 * Thrown when TMDB answers an error status (after the single 429 retry). Two statuses are
 * synthetic: `200` for a payload the schemas reject, `400` for an image path or image
 * base URL refused before any request, and `413` for an image over `IMAGE_MAX_BYTES`.
 */
export class TmdbRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`TMDB ${path} answered ${status}`);
    this.name = 'TmdbRequestError';
  }
}

/** What `createTmdbClient` needs; `fetch` and `delay` are the boundaries tests replace. */
export interface TmdbClientOptions {
  readonly apiKey: string;
  readonly language: string;
  readonly fetch: typeof globalThis.fetch;
  /** Waits `ms` before the 429 retry; tests pass a no-op. */
  readonly delay?: (ms: number) => Promise<void>;
}

const API_BASE = 'https://api.themoviedb.org/3';
/** TMDB answers in well under a second; a hung socket must not stall a whole run. */
const REQUEST_TIMEOUT_MS = 15_000;
/** `Retry-After` is honoured up to this; a longer wait is better reported as a failure. */
const RETRY_AFTER_CAP_S = 10;
/** Only TMDB-shaped image paths may become a URL (ADR-0003 § 4). */
const IMAGE_PATH = /^\/[A-Za-z0-9]+\.(?:jpg|png)$/;
/** The image CDN TMDB announces; any other configured host is refused (no open fetch). */
const IMAGE_HOST = 'image.tmdb.org';
/** A w1280 backdrop weighs ~500 KB; anything near this is not an image we want on disk. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Upper bounds on provider strings so a hostile payload cannot bloat a row. */
const TEXT_MAX = 10_000;
const NAME_MAX = 500;

const nullableString = z.string().max(NAME_MAX).nullable().optional();

const candidateList = z.array(
  z.object({
    id: z.number().int(),
    release_date: nullableString,
    first_air_date: nullableString,
  }),
);
const searchResponse = z.object({ results: candidateList });
const findResponse = z.object({ movie_results: candidateList, tv_results: candidateList });

const castList = z
  .array(
    z.object({
      name: z.string().max(NAME_MAX),
      character: z.string().max(NAME_MAX).optional().default(''),
      profile_path: nullableString,
      order: z.number().int().optional().default(0),
    }),
  )
  .optional()
  .default([]);
const genreList = z
  .array(z.object({ id: z.number().int(), name: z.string().max(NAME_MAX) }))
  .default([]);
const detailsCommon = {
  id: z.number().int(),
  overview: z.string().max(TEXT_MAX).optional().default(''),
  genres: genreList,
  vote_average: z.number().optional().default(0),
  vote_count: z.number().int().optional().default(0),
  poster_path: nullableString,
  backdrop_path: nullableString,
  credits: z.object({ cast: castList }).optional(),
};
const movieDetails = z.object({
  ...detailsCommon,
  title: z.string().max(NAME_MAX),
  release_date: nullableString,
  runtime: z.number().int().nullable().optional(),
});
const tvDetails = z.object({
  ...detailsCommon,
  name: z.string().max(NAME_MAX),
  first_air_date: nullableString,
  episode_run_time: z.array(z.number().int()).optional().default([]),
});
const seasonResponse = z.object({
  episodes: z.array(
    z.object({
      episode_number: z.number().int(),
      name: z.string().max(NAME_MAX).optional().default(''),
      overview: z.string().max(TEXT_MAX).optional().default(''),
      still_path: nullableString,
      air_date: nullableString,
      runtime: z.number().int().nullable().optional(),
      vote_average: z.number().optional().default(0),
      vote_count: z.number().int().optional().default(0),
    }),
  ),
});
const configurationResponse = z.object({
  images: z.object({ secure_base_url: z.url() }),
});

/** The announced image base URL, or null unless it is `https://image.tmdb.org/...`. */
function pinnedImageBase(announced: string): string | null {
  const url = new URL(announced);
  return url.protocol === 'https:' && url.hostname === IMAGE_HOST ? url.toString() : null;
}

type CandidateRow = z.infer<typeof candidateList>[number];

function toCandidate(row: CandidateRow): TmdbCandidate {
  const date = row.release_date ?? row.first_air_date ?? '';
  const year = Number.parseInt(date.slice(0, 4), 10);
  return { id: row.id, year: Number.isNaN(year) ? null : year };
}

type CastRow = z.infer<typeof castList>[number];

function normaliseCast(cast: readonly CastRow[]): readonly TmdbCastMember[] {
  return cast.map((member) => ({ ...member, profile_path: member.profile_path ?? null }));
}

/**
 * Reads a body chunk by chunk and returns its bytes, or null (stream cancelled) as soon as
 * more than `limit` bytes arrived, so an oversized image never sits in memory whole.
 * Recursion rather than a loop: no `await` in a loop (Sonar S9382) and no `.then()` chain.
 */
async function readCapped(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
  chunks: Uint8Array[] = [],
  total = 0,
): Promise<Uint8Array | null> {
  const { done, value } = await reader.read();
  if (done) {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  const size = total + value.byteLength;
  if (size > limit) {
    await reader.cancel();
    return null;
  }
  chunks.push(value);
  return readCapped(reader, limit, chunks, size);
}

/**
 * Builds the real client over `fetch`; one instance per server, no state but the image base
 * URL (read lazily from `/configuration` on the first image download, cached for the
 * client's life, forgotten when that call fails).
 */
export function createTmdbClient(options: TmdbClientOptions): TmdbClient {
  const delay = options.delay ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  let imageBaseUrl: Promise<z.infer<typeof configurationResponse>> | null = null;

  async function request(
    path: string,
    params: Record<string, string>,
    retried = false,
  ): Promise<unknown> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries({ ...params, language: options.language })) {
      url.searchParams.set(key, value);
    }
    const response = await options.fetch(url, {
      headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429 && !retried) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '1', 10);
      await response.body?.cancel(); // Release the connection before waiting.
      await delay(Math.min(Number.isNaN(retryAfter) ? 1 : retryAfter, RETRY_AFTER_CAP_S) * 1000);
      return request(path, params, true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TmdbRequestError(path, response.status);
    }
    return response.json();
  }

  /** `/configuration` is read on the first image of the client's life, then memoised. */
  async function imageBase(): Promise<string> {
    const pending = (imageBaseUrl ??= parsed('/configuration', {}, configurationResponse));
    try {
      const base = pinnedImageBase((await pending).images.secure_base_url);
      if (base === null) throw new TmdbRequestError('/configuration', 400);
      return base;
    } catch (error) {
      // A failed configuration call must not poison later runs; only forget our own promise.
      if (imageBaseUrl === pending) imageBaseUrl = null;
      throw error;
    }
  }

  async function parsed<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const result = schema.safeParse(await request(path, params));
    // 200 with an unexpected shape: reported as a request failure (spec 5a), not a crash.
    if (!result.success) throw new TmdbRequestError(path, 200);
    return result.data;
  }

  return {
    async search(kind, title, year) {
      const params: Record<string, string> = { query: title, include_adult: 'false' };
      if (year !== null) params[kind === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
      const body = await parsed(`/search/${kind}`, params, searchResponse);
      return body.results.map(toCandidate);
    },

    async findByImdb(kind, imdbId) {
      const body = await parsed(
        `/find/${encodeURIComponent(imdbId)}`,
        { external_source: 'imdb_id' },
        findResponse,
      );
      return (kind === 'movie' ? body.movie_results : body.tv_results).map(toCandidate);
    },

    async details(kind, id) {
      const params = { append_to_response: 'credits' };
      if (kind === 'movie') {
        const body = await parsed(`/movie/${id}`, params, movieDetails);
        return {
          id: body.id,
          title: body.title,
          overview: body.overview,
          genres: body.genres,
          date: body.release_date ?? '',
          runtimeMin: body.runtime ?? null,
          vote_average: body.vote_average,
          vote_count: body.vote_count,
          poster_path: body.poster_path ?? null,
          backdrop_path: body.backdrop_path ?? null,
          cast: normaliseCast(body.credits?.cast ?? []),
        };
      }
      const body = await parsed(`/tv/${id}`, params, tvDetails);
      return {
        id: body.id,
        title: body.name,
        overview: body.overview,
        genres: body.genres,
        date: body.first_air_date ?? '',
        runtimeMin: body.episode_run_time[0] ?? null,
        vote_average: body.vote_average,
        vote_count: body.vote_count,
        poster_path: body.poster_path ?? null,
        backdrop_path: body.backdrop_path ?? null,
        cast: normaliseCast(body.credits?.cast ?? []),
      };
    },

    async season(seriesId, season) {
      const body = await parsed(`/tv/${seriesId}/season/${season}`, {}, seasonResponse);
      return body.episodes.map((episode) => ({
        ...episode,
        still_path: episode.still_path ?? null,
        air_date: episode.air_date ?? null,
        runtime: episode.runtime ?? null,
      }));
    },

    async image(path, size) {
      if (!IMAGE_PATH.test(path)) throw new TmdbRequestError('/image', 400);
      const base = await imageBase();
      // No redirect: the pinned host must be the one that serves the bytes.
      const response = await options.fetch(`${base}${size}${path}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const announced = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || announced > IMAGE_MAX_BYTES) {
        await response.body?.cancel();
        throw new TmdbRequestError(`/image${path}`, response.ok ? 413 : response.status);
      }
      // The header may lie or be absent: count the bytes as they arrive, stop past the cap.
      const bytes = response.body
        ? await readCapped(response.body.getReader(), IMAGE_MAX_BYTES)
        : null;
      if (bytes === null) throw new TmdbRequestError(`/image${path}`, 413);
      return bytes;
    },
  };
}
