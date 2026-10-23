import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, artworkUrl, loadCatalog } from './api.js';
import { media } from './test-fixtures.js';

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('loadCatalog', () => {
  it('merges the media of every library', async () => {
    const a = media({ id: 'a', title: 'A' });
    const b = media({ id: 'b', title: 'B', libraryId: 'lib 2' });
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (url === '/api/libraries') return respond([{ id: 'lib-1' }, { id: 'lib 2' }]);
      if (url === '/api/libraries/lib-1/media') return respond([a]);
      if (url === '/api/libraries/lib%202/media') return respond([b]);
      return respond({ error: 'library_not_found' }, 404);
    });
    await expect(loadCatalog(fetchFn)).resolves.toEqual([a, b]);
  });

  it('throws an ApiRequestError on a non-2xx answer', async () => {
    const fetchFn = vi.fn(async () => respond({ error: 'internal' }, 500));
    await expect(loadCatalog(fetchFn)).rejects.toMatchObject({
      name: 'ApiRequestError',
      path: '/libraries',
      status: 500,
    });
  });

  it('throws an ApiRequestError without status on a network failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const error = await loadCatalog(fetchFn).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: null, message: 'Request to /libraries failed' });
  });
});

it('loadCatalog rejects a body that is not a list', async () => {
  const fetchFn = vi.fn(async () => respond({ unexpected: true }));
  await expect(loadCatalog(fetchFn)).rejects.toBeInstanceOf(ApiRequestError);
});

describe('artworkUrl', () => {
  it('encodes the file name under the API prefix', () => {
    expect(artworkUrl('ab cd.jpg')).toBe('/api/artwork/ab%20cd.jpg');
  });
});
