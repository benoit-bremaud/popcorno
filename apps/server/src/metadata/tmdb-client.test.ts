import { describe, expect, it, vi } from 'vitest';
import { createTmdbClient, IMAGE_MAX_BYTES, TmdbRequestError } from './tmdb-client.js';

type FetchFn = typeof globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A fetch double answering from a URL-substring → response table; unknown URLs are 404. */
function makeFetch(routes: Record<string, () => Response>) {
  return vi.fn<FetchFn>(async (input) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const match = Object.entries(routes).find(([needle]) => url.includes(needle));
    return match ? match[1]() : new Response('not found', { status: 404 });
  });
}

function makeClient(fetch: FetchFn, delay = vi.fn(async () => {})) {
  return createTmdbClient({ apiKey: 'secret-key', language: 'fr-FR', fetch, delay });
}

function requestedUrl(fetch: ReturnType<typeof makeFetch>, index = 0): URL {
  const input = fetch.mock.calls[index]?.[0];
  return new URL(input instanceof URL ? input.toString() : String(input));
}

describe('createTmdbClient', () => {
  it('searches movies with the year, the key in the header and the language, never in the URL', async () => {
    const fetch = makeFetch({
      '/search/movie': () =>
        jsonResponse({ results: [{ id: 603, release_date: '1999-03-30' }, { id: 7 }] }),
    });

    const results = await makeClient(fetch).search('movie', 'The Matrix', 1999);

    expect(results).toEqual([
      { id: 603, year: 1999 },
      { id: 7, year: null },
    ]);
    const url = requestedUrl(fetch);
    expect(url.pathname).toBe('/3/search/movie');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'The Matrix',
      include_adult: 'false',
      year: '1999',
      language: 'fr-FR',
    });
    expect(url.toString()).not.toContain('secret-key');
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
  });

  it('searches TV with first_air_date_year, and without any year filter when null', async () => {
    const fetch = makeFetch({
      '/search/tv': () => jsonResponse({ results: [{ id: 1396, first_air_date: '2008-01-20' }] }),
    });
    const client = makeClient(fetch);

    await client.search('tv', 'Breaking Bad', 2008);
    await client.search('tv', 'Breaking Bad', null);

    expect(requestedUrl(fetch, 0).searchParams.get('first_air_date_year')).toBe('2008');
    expect(requestedUrl(fetch, 1).searchParams.has('first_air_date_year')).toBe(false);
    expect(requestedUrl(fetch, 1).searchParams.has('year')).toBe(false);
  });

  it('finds by IMDb id and returns the results of the requested kind', async () => {
    const fetch = makeFetch({
      '/find/tt0133093': () =>
        jsonResponse({
          movie_results: [{ id: 603, release_date: '1999-03-30' }],
          tv_results: [{ id: 9, first_air_date: '2001-01-01' }],
        }),
    });
    const client = makeClient(fetch);

    expect(await client.findByImdb('movie', 'tt0133093')).toEqual([{ id: 603, year: 1999 }]);
    expect(await client.findByImdb('tv', 'tt0133093')).toEqual([{ id: 9, year: 2001 }]);
    expect(requestedUrl(fetch).searchParams.get('external_source')).toBe('imdb_id');
  });

  it('fetches movie details with the credits appended, normalised to one shape', async () => {
    const fetch = makeFetch({
      '/movie/603': () =>
        jsonResponse({
          id: 603,
          title: 'The Matrix',
          overview: 'Neo.',
          genres: [{ id: 28, name: 'Action' }],
          release_date: '1999-03-30',
          runtime: 136,
          vote_average: 8.2,
          vote_count: 100,
          poster_path: '/p.jpg',
          backdrop_path: null,
          credits: { cast: [{ name: 'Keanu Reeves', character: 'Neo', order: 0 }] },
        }),
    });

    const details = await makeClient(fetch).details('movie', 603);

    expect(details).toEqual({
      id: 603,
      title: 'The Matrix',
      overview: 'Neo.',
      genres: [{ id: 28, name: 'Action' }],
      date: '1999-03-30',
      runtimeMin: 136,
      vote_average: 8.2,
      vote_count: 100,
      poster_path: '/p.jpg',
      backdrop_path: null,
      cast: [{ name: 'Keanu Reeves', character: 'Neo', profile_path: null, order: 0 }],
    });
    expect(requestedUrl(fetch).searchParams.get('append_to_response')).toBe('credits');
  });

  it('fetches TV details, taking the name, first air date and first episode run time', async () => {
    const fetch = makeFetch({
      '/tv/1396': () =>
        jsonResponse({
          id: 1396,
          name: 'Breaking Bad',
          first_air_date: '2008-01-20',
          episode_run_time: [45, 47],
          genres: [],
        }),
    });

    const details = await makeClient(fetch).details('tv', 1396);

    expect(details).toMatchObject({
      id: 1396,
      title: 'Breaking Bad',
      date: '2008-01-20',
      runtimeMin: 45,
      overview: '',
      vote_average: 0,
      cast: [],
    });
  });

  it('fetches a season and fills the optional episode fields', async () => {
    const fetch = makeFetch({
      '/tv/1396/season/1': () =>
        jsonResponse({ episodes: [{ episode_number: 1, name: 'Pilot', vote_average: 8.1 }] }),
    });

    const episodes = await makeClient(fetch).season(1396, 1);

    expect(episodes).toEqual([
      {
        episode_number: 1,
        name: 'Pilot',
        overview: '',
        still_path: null,
        air_date: null,
        runtime: null,
        vote_average: 8.1,
        vote_count: 0,
      },
    ]);
  });

  it('downloads an image from the configured base URL, reading the configuration once', async () => {
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }),
      'image.tmdb.org': () => new Response(new Uint8Array([1, 2, 3])),
    });
    const client = makeClient(fetch);

    const first = await client.image('/abc.jpg', 'w500');
    const second = await client.image('/def.png', 'w1280');

    expect([...first]).toEqual([1, 2, 3]);
    expect([...second]).toEqual([1, 2, 3]);
    const urls = fetch.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.includes('/configuration'))).toHaveLength(1);
    expect(urls).toContain('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(urls).toContain('https://image.tmdb.org/t/p/w1280/def.png');
  });

  it('refuses an image path that is not TMDB-shaped before any request', async () => {
    const fetch = makeFetch({});

    await expect(makeClient(fetch).image('/../etc/passwd', 'w500')).rejects.toBeInstanceOf(
      TmdbRequestError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forgets a failed configuration call so a later image request retries it', async () => {
    let configCalls = 0;
    const fetch = makeFetch({
      '/configuration': () => {
        configCalls += 1;
        return configCalls === 1
          ? new Response('down', { status: 503 })
          : jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } });
      },
      'image.tmdb.org': () => new Response(new Uint8Array([9])),
    });
    const client = makeClient(fetch);

    await expect(client.image('/a.jpg', 'w500')).rejects.toBeInstanceOf(TmdbRequestError);
    expect([...(await client.image('/a.jpg', 'w500'))]).toEqual([9]);
    expect(configCalls).toBe(2);
  });

  it('keeps one request in flight across concurrent callers (one queue per client)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetch = vi.fn<FetchFn>(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((done) => setTimeout(done, 1));
      inFlight -= 1;
      return jsonResponse({ results: [] });
    });
    const client = makeClient(fetch);

    // Two libraries enriching at once share the client.
    await Promise.all([
      client.search('movie', 'a', null),
      client.search('tv', 'b', null),
      client.search('movie', 'c', null),
    ]);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });

  it('frees the queue after a failed request', async () => {
    const fetch = makeFetch({
      '/movie/1': () => new Response('down', { status: 503 }),
      '/search/movie': () => jsonResponse({ results: [] }),
    });
    const client = makeClient(fetch);

    await expect(client.details('movie', 1)).rejects.toMatchObject({ status: 503 });
    await expect(client.search('movie', 'x', null)).resolves.toEqual([]);
  });

  it('retries once after a 429, waiting Retry-After seconds (capped at 10)', async () => {
    let calls = 0;
    const fetch = makeFetch({
      '/search/movie': () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({}, 429, { 'retry-after': '30' })
          : jsonResponse({ results: [] });
      },
    });
    const delay = vi.fn(async () => {});

    const results = await makeClient(fetch, delay).search('movie', 'x', null);

    expect(results).toEqual([]);
    expect(delay).toHaveBeenCalledWith(10_000);
    expect(calls).toBe(2);
  });

  it('gives up after a second 429 and reports the status without the key', async () => {
    const fetch = makeFetch({ '/search/movie': () => jsonResponse({}, 429) });
    const delay = vi.fn(async () => {});

    const failure = makeClient(fetch, delay).search('movie', 'x', null);

    await expect(failure).rejects.toMatchObject({ status: 429, path: '/search/movie' });
    await expect(failure).rejects.toThrow(/^TMDB \/search\/movie answered 429$/);
    expect(delay).toHaveBeenCalledWith(1000);
  });

  it('reports a 404 as a request error (an unknown provider id)', async () => {
    const fetch = makeFetch({});

    await expect(makeClient(fetch).details('movie', 1)).rejects.toMatchObject({ status: 404 });
  });

  it('treats a 200 with an unexpected shape as a failed request, not a crash', async () => {
    const fetch = makeFetch({ '/movie/1': () => jsonResponse({ unexpected: true }) });

    await expect(makeClient(fetch).details('movie', 1)).rejects.toMatchObject({
      status: 200,
      path: '/movie/1',
    });
  });

  it('refuses an image base URL that is not https on image.tmdb.org', async () => {
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://evil.example/t/p/' } }),
    });

    await expect(makeClient(fetch).image('/a.jpg', 'w500')).rejects.toMatchObject({
      path: '/configuration',
      status: 400,
    });
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('evil'))).toBe(false);
  });

  it('fetches images without following redirects', async () => {
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }),
      'image.tmdb.org': () => new Response(new Uint8Array([1])),
    });

    await makeClient(fetch).image('/a.jpg', 'w500');

    const init = fetch.mock.calls.find(
      (call) => new URL(String(call[0])).hostname === 'image.tmdb.org',
    )?.[1];
    expect(init?.redirect).toBe('error');
  });

  it('refuses an image larger than IMAGE_MAX_BYTES, announced or actual', async () => {
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    let announced = true;
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }),
      'image.tmdb.org': () =>
        announced
          ? new Response(new Uint8Array([1]), { headers: { 'content-length': String(big.length) } })
          : new Response(big),
    });
    const client = makeClient(fetch);

    await expect(client.image('/a.jpg', 'w500')).rejects.toMatchObject({ status: 413 });
    announced = false;
    await expect(client.image('/a.jpg', 'w500')).rejects.toMatchObject({ status: 413 });
  });

  it('stops reading an unannounced image stream as soon as it passes the cap', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    let cancelled = false;
    // An endless body with no Content-Length: only a streaming cap can stop it.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }),
      'image.tmdb.org': () => new Response(endless),
    });

    await expect(makeClient(fetch).image('/a.jpg', 'w500')).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(IMAGE_MAX_BYTES / chunk.byteLength + 3);
  });

  it('reassembles a chunked image under the cap byte for byte', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }),
      'image.tmdb.org': () => new Response(body),
    });

    expect([...(await makeClient(fetch).image('/a.jpg', 'w500'))]).toEqual([1, 2, 3]);
  });

  it('rejects a payload whose strings exceed the bounds as an invalid shape', async () => {
    const fetch = makeFetch({
      '/movie/1': () => jsonResponse({ id: 1, title: 'x', overview: 'o'.repeat(10_001) }),
    });

    await expect(makeClient(fetch).details('movie', 1)).rejects.toMatchObject({ status: 200 });
  });

  it('reports a failed image download with its status', async () => {
    const fetch = makeFetch({
      '/configuration': () =>
        jsonResponse({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }),
      'image.tmdb.org': () => new Response('gone', { status: 410 }),
    });

    await expect(makeClient(fetch).image('/a.jpg', 'w500')).rejects.toMatchObject({ status: 410 });
  });
});
