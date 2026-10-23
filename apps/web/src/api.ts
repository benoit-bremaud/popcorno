import type { Library, Media } from '@popcorno/shared';

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
