import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError, invalid } from '../http.js';
import { isAtOrUnderRoot, resolveUnderRoot } from '../library/path-guard.js';
import type { LibraryRepository } from '../library/repository.js';
import { parseRange } from './range.js';

/** What the playback routes need; built by `buildApp`. */
export interface PlaybackRoutesDeps {
  readonly repository: LibraryRepository;
  /** Absolute folder every served file must resolve under (`ServerConfig.mediaRoot`). */
  readonly mediaRoot: string;
}

const mediaParams = z.object({ id: z.uuid() });

// Served types; which of them the browser may play directly is decided in shared `playback.ts`.
const MIME_TYPES: Readonly<Partial<Record<string, string>>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

/** An open file to stream: its handle, size and MIME type, after the confinement check. */
interface ServableFile {
  readonly handle: FileHandle;
  readonly size: number;
  readonly mime: string;
}

/**
 * Re-runs the path guard (spec direct-play 4b): the real file must sit under the real
 * library root, itself the real `MEDIA_ROOT` or under it. Returns the checked real path,
 * or null on any escape or I/O error. Shared with the HLS session route.
 */
export async function confinedPath(
  filePath: string,
  rootPath: string,
  mediaRoot: string,
): Promise<string | null> {
  try {
    const [file, root, realMediaRoot] = await Promise.all([
      realpath(filePath),
      realpath(rootPath),
      realpath(mediaRoot),
    ]);
    if (!isAtOrUnderRoot(realMediaRoot, root) || resolveUnderRoot(root, file) === null) return null;
    return file;
  } catch {
    return null;
  }
}

/**
 * Checks the path on every request, then opens the checked real path without following a
 * final symlink and sizes it from that handle, so a swap after the check cannot change
 * what is served. Null on any escape or I/O error.
 */
async function confinedFile(
  filePath: string,
  rootPath: string,
  mediaRoot: string,
): Promise<ServableFile | null> {
  const file = await confinedPath(filePath, rootPath, mediaRoot);
  if (file === null) return null;
  let handle: FileHandle | null = null;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) {
      await handle.close();
      return null;
    }
    const mime = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return { handle, size: info.size, mime };
  } catch {
    await handle?.close();
    return null;
  }
}

/**
 * `GET /media/:id/file` (200 whole file | 206 one range | 400 `invalid_request` |
 * 404 `media_not_found` | 416 unsatisfiable range) — the direct-play stream of UC5
 * (spec direct-play, ADR-0005). The id resolves to the path stored at scan time; no
 * client-supplied path reaches the file system.
 */
export function registerPlaybackRoutes(app: FastifyInstance, deps: PlaybackRoutesDeps): void {
  app.get('/media/:id/file', async (request, reply) => {
    const params = mediaParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid(params.error.issues));
    const stored = deps.repository.findMediaFile(params.data.id);
    const file =
      stored === null ? null : await confinedFile(stored.filePath, stored.rootPath, deps.mediaRoot);
    if (file === null) return reply.code(404).send(apiError('media_not_found'));

    const wanted = parseRange(request.headers.range, file.size);
    reply.header('Accept-Ranges', 'bytes');
    if (wanted.kind === 'unsatisfiable') {
      await file.handle.close();
      return reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
    }
    reply.header('Content-Type', file.mime);
    if (wanted.kind === 'whole') {
      return reply
        .code(200)
        .header('Content-Length', file.size)
        .send(file.handle.createReadStream());
    }
    const { start, end } = wanted.range;
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${file.size}`)
      .header('Content-Length', end - start + 1)
      .send(file.handle.createReadStream({ start, end }));
  });
}
