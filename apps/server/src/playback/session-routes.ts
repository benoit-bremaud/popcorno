import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { directPlayMime } from '@popcorno/shared';
import type { PlaybackStart } from '@popcorno/shared';
import { apiError, invalid } from '../http.js';
import type { LibraryRepository } from '../library/repository.js';
import { PLAYLIST_NAME } from './ffmpeg-args.js';
import { confinedPath } from './routes.js';
import type { SessionManager } from './session-manager.js';

/** What the session routes need; built by `buildApp`. */
export interface SessionRoutesDeps {
  readonly repository: LibraryRepository;
  readonly sessions: SessionManager;
  readonly mediaRoot: string;
}

const startBody = z.object({ mediaId: z.uuid(), directPlay: z.boolean() });
const sessionParams = z.object({ id: z.uuid() });
const fileParams = z.object({ id: z.uuid(), file: z.string() });

const START_ERRORS = {
  busy: { status: 503, code: 'transcode_busy' },
  failed: { status: 502, code: 'transcode_failed' },
  not_playable: { status: 422, code: 'not_playable' },
} as const;

async function openOrNull(path: string): Promise<FileHandle | null> {
  try {
    return await open(path);
  } catch {
    return null;
  }
}

/**
 * UC5 sessions (spec hls-transcode, ADR-0006): `POST /playback/sessions` (200 direct |
 * 201 hls | 400 | 404 `media_not_found` | 422 `not_playable` | 502 `transcode_failed` |
 * 503 `transcode_busy`), the playlist and segment files, the heartbeat and `DELETE`.
 */
export function registerSessionRoutes(app: FastifyInstance, deps: SessionRoutesDeps): void {
  app.post('/playback/sessions', async (request, reply) => {
    const body = startBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(invalid(body.error.issues));
    const { mediaId, directPlay } = body.data;
    const stored = deps.repository.findMediaFile(mediaId);
    if (stored === null) return reply.code(404).send(apiError('media_not_found'));
    const streams = deps.repository.findMediaStreams(mediaId);

    // The browser's answer counts only for a file the shared rule calls direct-playable.
    const mime = directPlay ? directPlayMime({ relativePath: stored.filePath, streams }) : null;
    if (mime !== null) {
      const direct: PlaybackStart = {
        mode: 'direct',
        url: `/media/${mediaId}/file`,
        mime,
      };
      return reply.code(200).send(direct);
    }

    const input = await confinedPath(stored.filePath, stored.rootPath, deps.mediaRoot);
    if (input === null) return reply.code(404).send(apiError('media_not_found'));
    const result = await deps.sessions.open(input, streams);
    if (result.kind !== 'ready') {
      const { status, code } = START_ERRORS[result.kind];
      return reply.code(status).send(apiError(code));
    }
    const hls: PlaybackStart = {
      mode: 'hls',
      sessionId: result.id,
      url: `/playback/sessions/${result.id}/${PLAYLIST_NAME}`,
    };
    return reply.code(201).send(hls);
  });

  app.post('/playback/sessions/:id/heartbeat', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid(params.error.issues));
    if (!deps.sessions.touch(params.data.id)) {
      return reply.code(404).send(apiError('session_not_found'));
    }
    return reply.code(204).send();
  });

  app.delete('/playback/sessions/:id', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid(params.error.issues));
    if (!(await deps.sessions.close(params.data.id))) {
      return reply.code(404).send(apiError('session_not_found'));
    }
    return reply.code(204).send();
  });

  app.get('/playback/sessions/:id/:file', async (request, reply) => {
    const params = fileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid(params.error.issues));
    const { id, file } = params.data;
    if (!deps.sessions.touch(id)) return reply.code(404).send(apiError('session_not_found'));
    const path = deps.sessions.filePath(id, file);
    if (path === null) return reply.code(404).send(apiError('segment_not_found'));
    const handle = await openOrNull(path);
    // Not written yet, or removed by a concurrent close.
    if (handle === null) return reply.code(404).send(apiError('segment_not_found'));
    const isPlaylist = file === PLAYLIST_NAME;
    return reply
      .code(200)
      .header('Content-Type', isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
      .header('Cache-Control', 'no-store')
      .send(handle.createReadStream());
  });
}
