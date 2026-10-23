import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError, invalid } from '../http.js';
import { resolveUnderRoot } from '../library/path-guard.js';
import type { LibraryRepository } from '../library/repository.js';
import { parseRange } from './range.js';

/** What the playback routes need; built by `buildApp`. */
export interface PlaybackRoutesDeps {
  readonly repository: LibraryRepository;
  /** Absolute folder every served file must resolve under (`ServerConfig.mediaRoot`). */
  readonly mediaRoot: string;
}

const mediaParams = z.object({ id: z.uuid() });

const MIME_TYPES: Readonly<Partial<Record<string, string>>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

/** A file to stream: its real path and size, after the confinement check. */
interface ServableFile {
  readonly path: string;
  readonly size: number;
}

/**
 * Re-runs the path guard on every request (spec 4b): the real file must sit under the real
 * library root, itself the real `MEDIA_ROOT` or under it. Null on any escape or I/O error.
 */
async function confinedFile(
  filePath: string,
  rootPath: string,
  mediaRoot: string,
): Promise<ServableFile | null> {
  try {
    const [file, root, realMediaRoot] = await Promise.all([
      realpath(filePath),
      realpath(rootPath),
      realpath(mediaRoot),
    ]);
    const rootConfined = root === realMediaRoot || resolveUnderRoot(realMediaRoot, root) !== null;
    if (!rootConfined || resolveUnderRoot(root, file) === null) return null;
    const info = await stat(file);
    return info.isFile() ? { path: file, size: info.size } : null;
  } catch {
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

    const range = parseRange(request.headers.range, file.size);
    reply
      .header('Accept-Ranges', 'bytes')
      .header(
        'Content-Type',
        MIME_TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
      );
    if (range === null) {
      return reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
    }
    if (range === undefined) {
      return reply.code(200).header('Content-Length', file.size).send(createReadStream(file.path));
    }
    return reply
      .code(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`)
      .header('Content-Length', range.end - range.start + 1)
      .send(createReadStream(file.path, range));
  });
}
