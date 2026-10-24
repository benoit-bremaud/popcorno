import type {
  Library,
  Media,
  PlaybackSessionBody,
  PlaybackStart,
  ProgressBody,
  WatchProgress,
} from '@popcorno/shared';

/** Prefix the dev server (and the production reverse proxy) forwards to the API. */
const API = '/api';

/** A non-2xx answer or a network failure while loading the catalog. */
export class ApiRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
  ) {
    const reason = status === null ? '' : ` with ${status}`;
    super(`Request to ${path} failed${reason}`);
    this.name = 'ApiRequestError';
  }
}

type Fetch = typeof fetch;

/** GET a JSON array; anything else (error status, network failure, other shape) throws. */
async function getList<T>(fetchFn: Fetch, path: string): Promise<T[]> {
  let response: Response;
  try {
    response = await fetchFn(`${API}${path}`);
  } catch {
    throw new ApiRequestError(path, null);
  }
  if (!response.ok) throw new ApiRequestError(path, response.status);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new ApiRequestError(path, response.status);
  return body as T[];
}

/** Every media of every library (sequence diagram 02); `fetchFn` is injected for tests. */
export async function loadCatalog(fetchFn: Fetch = fetch): Promise<Media[]> {
  const libraries = await getList<Library>(fetchFn, '/libraries');
  const perLibrary = await Promise.all(
    libraries.map((library) =>
      getList<Media>(fetchFn, `/libraries/${encodeURIComponent(library.id)}/media`),
    ),
  );
  return perLibrary.flat();
}

/** URL of a cached artwork file served by `GET /artwork/:file`. */
export function artworkUrl(file: string): string {
  return `${API}/artwork/${encodeURIComponent(file)}`;
}

/** Why a playback could not start: another title holds the transcoder, or anything else. */
export type PlaybackStartError = 'busy' | 'failed';

/**
 * `POST /playback/sessions` (spec hls-transcode §2.1): the server confirms direct play or
 * starts an HLS session. URLs come back relative to the API and are prefixed here.
 */
export async function startPlayback(
  body: PlaybackSessionBody,
  fetchFn: Fetch = fetch,
): Promise<PlaybackStart | PlaybackStartError> {
  try {
    const response = await fetchFn(`${API}/playback/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 503) return 'busy';
    if (!response.ok) return 'failed';
    const start = (await response.json()) as PlaybackStart;
    return { ...start, url: `${API}${start.url}` };
  } catch {
    // Network failure, or a body that is not JSON (a proxy error page).
    return 'failed';
  }
}

/** Keeps a paused HLS session alive (ADR-0006 §4); a lost heartbeat is harmless. */
export async function sendHeartbeat(sessionId: string, fetchFn: Fetch = fetch): Promise<void> {
  try {
    await fetchFn(`${API}/playback/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
      method: 'POST',
    });
  } catch {
    // The idle watchdog is the safety net.
  }
}

/** Ends an HLS session; `keepalive` lets it leave even while the page unloads. */
export async function stopPlayback(sessionId: string, fetchFn: Fetch = fetch): Promise<void> {
  try {
    await fetchFn(`${API}/playback/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      keepalive: true,
    });
  } catch {
    // The idle watchdog is the safety net.
  }
}

/**
 * `PUT /media/:id/progress` (spec resume-playback §2.2); `keepalive` lets the last save
 * leave while the player closes. A lost save is harmless: the next one is newer.
 */
export async function saveProgress(
  mediaId: string,
  positionSec: number,
  fetchFn: Fetch = fetch,
): Promise<void> {
  try {
    await fetchFn(`${API}/media/${encodeURIComponent(mediaId)}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionSec } satisfies ProgressBody),
      keepalive: true,
    });
  } catch {
    // Ignored on purpose (spec 6a).
  }
}

/** `GET /progress`; an unreachable server simply means "nothing to resume". */
export async function loadProgress(fetchFn: Fetch = fetch): Promise<WatchProgress[]> {
  try {
    return await getList<WatchProgress>(fetchFn, '/progress');
  } catch {
    return [];
  }
}
