import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTWORK_FILE, ArtworkCache } from './artwork-cache.js';
import type { TmdbClient } from './tmdb-client.js';

function makeClient(image: TmdbClient['image']): TmdbClient {
  const unused = () => Promise.reject(new Error('not used by the cache'));
  return { image, search: unused, findByImdb: unused, details: unused, season: unused };
}

describe('ArtworkCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'popcorno-art-')), 'artwork');
  });

  afterEach(async () => {
    await rm(join(dir, '..'), { recursive: true, force: true });
  });

  it('downloads a new image once into a digest-named file and reuses it afterwards', async () => {
    const image = vi.fn<TmdbClient['image']>(async () => new Uint8Array([0xff, 0xd8]));
    const cache = new ArtworkCache(dir, makeClient(image));

    const first = await cache.cache('/poster.jpg', 'w500');
    const second = await cache.cache('/poster.jpg', 'w500');

    expect(first).toMatch(ARTWORK_FILE);
    expect(first).toBe(second);
    expect(image).toHaveBeenCalledTimes(1);
    expect(image).toHaveBeenCalledWith('/poster.jpg', 'w500');
    expect([...(await readFile(join(dir, first ?? '')))]).toEqual([0xff, 0xd8]);
    expect(await readdir(dir)).toEqual([first]);
  });

  it('names the file by size and path, keeping the image extension', async () => {
    const cache = new ArtworkCache(
      dir,
      makeClient(async () => new Uint8Array([1])),
    );

    const poster = await cache.cache('/same.png', 'w500');
    const backdrop = await cache.cache('/same.png', 'w1280');

    expect(poster).not.toBe(backdrop);
    expect(poster?.endsWith('.png')).toBe(true);
  });

  it('returns null without a request when TMDB has no image', async () => {
    const image = vi.fn<TmdbClient['image']>();
    const cache = new ArtworkCache(dir, makeClient(image));

    expect(await cache.cache(null, 'w500')).toBeNull();
    expect(image).not.toHaveBeenCalled();
  });

  it('returns null and leaves no file behind when the download fails', async () => {
    const cache = new ArtworkCache(
      dir,
      makeClient(async () => {
        throw new Error('network');
      }),
    );

    expect(await cache.cache('/poster.jpg', 'w500')).toBeNull();
    await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exposes its directory for the serving route', () => {
    expect(new ArtworkCache(dir, makeClient(vi.fn())).directory).toBe(dir);
  });
});
