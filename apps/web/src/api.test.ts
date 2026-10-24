import { describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  artworkUrl,
  loadCatalog,
  loadProgress,
  saveProgress,
  sendHeartbeat,
  startPlayback,
  stopPlayback,
} from './api.js';
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

describe('startPlayback', () => {
  it('posts the decision and prefixes the returned URL with the API path', async () => {
    const fetchFn = vi.fn(async () =>
      respond(
        { mode: 'hls', sessionId: 's', url: '/playback/sessions/s/index.m3u8', offsetSec: 30 },
        201,
      ),
    );

    const start = await startPlayback({ mediaId: 'm1', directPlay: false, startSec: 30 }, fetchFn);

    expect(start).toEqual({
      mode: 'hls',
      sessionId: 's',
      url: '/api/playback/sessions/s/index.m3u8',
      offsetSec: 30,
    });
    expect(fetchFn).toHaveBeenCalledWith('/api/playback/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: 'm1', directPlay: false, startSec: 30 }),
    });
  });

  it.each([
    [503, 'busy'],
    [502, 'failed'],
    [404, 'failed'],
  ])('maps %i to %s', async (status, expected) => {
    await expect(
      startPlayback({ mediaId: 'm1', directPlay: true }, async () => respond({}, status)),
    ).resolves.toBe(expected);
  });

  it('maps a 2xx body that is not JSON to failed', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 200 }));
    await expect(startPlayback({ mediaId: 'm1', directPlay: true }, fetchFn)).resolves.toBe(
      'failed',
    );
  });

  it('maps a network failure to failed', async () => {
    const fetchFn = vi.fn(async (): Promise<Response> => {
      throw new TypeError('offline');
    });
    await expect(startPlayback({ mediaId: 'm1', directPlay: true }, fetchFn)).resolves.toBe(
      'failed',
    );
  });
});

describe('session heartbeat and stop', () => {
  it('posts the heartbeat and deletes with keepalive', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));

    await sendHeartbeat('s 1', fetchFn);
    await stopPlayback('s 1', fetchFn);

    expect(fetchFn).toHaveBeenNthCalledWith(1, '/api/playback/sessions/s%201/heartbeat', {
      method: 'POST',
    });
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/playback/sessions/s%201', {
      method: 'DELETE',
      keepalive: true,
    });
  });

  it('swallows network failures: the idle watchdog cleans up', async () => {
    const fetchFn = vi.fn(async (): Promise<Response> => {
      throw new TypeError('offline');
    });
    await expect(sendHeartbeat('s', fetchFn)).resolves.toBeUndefined();
    await expect(stopPlayback('s', fetchFn)).resolves.toBeUndefined();
  });
});

describe('saveProgress', () => {
  it('puts the position with keepalive', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));

    await saveProgress('m 1', 42, fetchFn);

    expect(fetchFn).toHaveBeenCalledWith('/api/media/m%201/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionSec: 42 }),
      keepalive: true,
    });
  });

  it('swallows a network failure', async () => {
    const fetchFn = vi.fn(async (): Promise<Response> => {
      throw new TypeError('offline');
    });

    await expect(saveProgress('m1', 1, fetchFn)).resolves.toBeUndefined();
  });
});

describe('loadProgress', () => {
  it('returns the saved positions', async () => {
    const rows = [
      { mediaId: 'm1', positionSec: 5, durationSec: 10, finished: false, updatedAt: 'x' },
    ];

    await expect(loadProgress(async () => respond(rows, 200))).resolves.toEqual(rows);
  });

  it('returns nothing when the server fails', async () => {
    await expect(loadProgress(async () => respond({}, 500))).resolves.toEqual([]);
  });
});
