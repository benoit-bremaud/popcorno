import { createHash } from 'node:crypto';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { TmdbClient } from './tmdb-client.js';

/** Poster and episode-still width; TMDB offers `w92 … w780, original` (ADR-0003 § 4). */
export const POSTER_SIZE = 'w500';
/** Backdrop width; TMDB offers `w300, w780, w1280, original`. */
export const BACKDROP_SIZE = 'w1280';

/** File names the cache writes and the route serves: a SHA-256 digest plus the image extension. */
export const ARTWORK_FILE = /^[a-f0-9]{64}\.(?:jpg|png)$/;

/**
 * The only writer under the artwork folder. A TMDB path is downloaded once (through the
 * client, the single HTTP egress) into `<dir>/<sha256(size + path)>.<ext>`; the file name
 * is what gets persisted and served, never the provider's string.
 */
export class ArtworkCache {
  constructor(
    private readonly dir: string,
    private readonly client: TmdbClient,
  ) {}

  /** Folder every image is served from (`GET /artwork/:file`). */
  get directory(): string {
    return this.dir;
  }

  /**
   * The cached file name for a TMDB path at a size, downloading it when absent. Null when
   * TMDB has no image (`path` null) or the download failed (spec 7a: the title is still
   * matched, a `refresh` fetches it again).
   */
  async cache(path: string | null, size: string): Promise<string | null> {
    if (path === null) return null;
    const file = `${createHash('sha256').update(`${size}${path}`).digest('hex')}${extname(path)}`;
    const target = join(this.dir, file);
    if (await exists(target)) return file;
    try {
      const bytes = await this.client.image(path, size);
      await mkdir(this.dir, { recursive: true });
      // Write then rename: a crash mid-download never leaves a truncated file to serve.
      const partial = `${target}.part`;
      await writeFile(partial, bytes);
      await rename(partial, target);
      return file;
    } catch {
      return null;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
