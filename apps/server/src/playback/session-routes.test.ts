import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, Library, Media, PlaybackStart, StreamInfo } from '@popcorno/shared';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/index.js';
import type { Transcoder } from './transcoder.js';

function stream(type: StreamInfo['type'], codec: string): StreamInfo {
  return { type, codec, width: null, height: null, language: null };
}

/** Streams the fake prober reports: by extension, audio only for a "Concert" file. */
function probedStreams(path: string): readonly StreamInfo[] {
  if (path.includes('Concert')) return [stream('audio', 'flac')];
  return path.endsWith('.mp4')
    ? [stream('video', 'h264'), stream('audio', 'aac')]
    : [stream('video', 'hevc'), stream('audio', 'ac3')];
}

describe('playback session routes', () => {
  let app: FastifyInstance;
  let base: string;
  let root: string;
  let kills: Mock<() => void>;
  let spawned: (readonly string[])[];

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'popcorno-sessions-routes-'));
    const mediaRoot = join(base, 'media');
    root = join(mediaRoot, 'films');
    await mkdir(root, { recursive: true });
    kills = vi.fn();
    spawned = [];
    // Writes the playlist and a first segment, as FFmpeg does once it has started.
    const transcoder: Transcoder = (args) => {
      spawned.push(args);
      const playlist = args.at(-1) ?? '';
      writeFileSync(join(dirname(playlist), 'segment-00000.ts'), 'TS');
      writeFileSync(playlist, '#EXTM3U\n');
      return { kill: kills };
    };
    app = buildApp({
      version: 'test',
      db: openDatabase(':memory:'),
      probe: async (path) => ({
        durationSec: 60,
        streams: probedStreams(path),
      }),
      mediaRoot,
      tmdb: null,
      artworkDir: join(base, 'artwork'),
      transcoder,
      transcodeDir: join(base, 'transcode'),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
  });

  async function scanned(name: string): Promise<Media> {
    await writeFile(join(root, name), 'bytes');
    const library = (
      await app.inject({
        method: 'POST',
        url: '/libraries',
        payload: { name: 'Films', rootPath: root, kind: 'films' },
      })
    ).json<Library>();
    await app.inject({ method: 'POST', url: `/libraries/${library.id}/scan` });
    const list = await app.inject({ method: 'GET', url: `/libraries/${library.id}/media` });
    const item = list.json<Media[]>().find((media) => media.relativePath === name);
    if (item === undefined) throw new Error(`${name} was not scanned`);
    return item;
  }

  function start(mediaId: string, directPlay: boolean, startSec?: number) {
    return app.inject({
      method: 'POST',
      url: '/playback/sessions',
      payload: { mediaId, directPlay, startSec },
    });
  }

  async function hlsSession(): Promise<Extract<PlaybackStart, { mode: 'hls' }>> {
    const media = await scanned('Heat (1995).mkv');
    const response = await start(media.id, false);
    const body = response.json<PlaybackStart>();
    if (body.mode !== 'hls') throw new Error('expected hls');
    return body;
  }

  it('confirms direct play for a file the shared rule calls direct-playable', async () => {
    const media = await scanned('Heat (1995).mp4');

    const response = await start(media.id, true);

    expect(response.statusCode).toBe(200);
    expect(response.json<PlaybackStart>()).toEqual({
      mode: 'direct',
      url: `/media/${media.id}/file`,
      mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
      startSec: 0,
      offsetSec: 0,
    });
    expect(spawned).toHaveLength(0);
  });

  it('starts HLS when the browser cannot direct-play an MP4', async () => {
    const media = await scanned('Heat (1995).mp4');

    const response = await start(media.id, false);

    expect(response.statusCode).toBe(201);
    expect(response.json<PlaybackStart>().mode).toBe('hls');
  });

  it('starts HLS for an MKV even when the client claims direct play', async () => {
    const media = await scanned('Heat (1995).mkv');

    const response = await start(media.id, true);

    expect(response.statusCode).toBe(201);
    const body = response.json<PlaybackStart>();
    expect(body.mode).toBe('hls');
    if (body.mode === 'hls') {
      expect(body.url).toBe(`/playback/sessions/${body.sessionId}/index.m3u8`);
    }
    expect(spawned[0]).toContain('libx264');
  });

  it('starts FFmpeg at the resume offset and reports it', async () => {
    const media = await scanned('Heat (1995).mkv');

    const response = await start(media.id, false, 42);

    expect(response.statusCode).toBe(201);
    expect(response.json<PlaybackStart>().offsetSec).toBe(42);
    expect(spawned[0]?.slice(4, 6)).toEqual(['-ss', '42']);
  });

  it('starts over when the offset is at or past the end of the file', async () => {
    const media = await scanned('Heat (1995).mkv');

    const response = await start(media.id, false, 60);

    expect(response.json<PlaybackStart>()).toMatchObject({ startSec: 0, offsetSec: 0 });
    expect(spawned[0]).not.toContain('-ss');
  });

  it('keeps the direct-play timeline at 0 when resuming', async () => {
    const media = await scanned('Heat (1995).mp4');

    const response = await start(media.id, true, 42);

    expect(response.json<PlaybackStart>()).toMatchObject({ startSec: 42, offsetSec: 0 });
  });

  it.each([-1, 1.5, 'x', 7 * 86_400 + 1])('rejects the start offset %s', async (startSec) => {
    const media = await scanned('Heat (1995).mkv');

    const response = await app.inject({
      method: 'POST',
      url: '/playback/sessions',
      payload: { mediaId: media.id, directPlay: false, startSec },
    });

    expect(response.statusCode).toBe(400);
  });

  it('serves the playlist and segments with their types, never cached', async () => {
    const session = await hlsSession();

    const playlist = await app.inject({ method: 'GET', url: session.url });
    const segment = await app.inject({
      method: 'GET',
      url: `/playback/sessions/${session.sessionId}/segment-00000.ts`,
    });

    expect(playlist.statusCode).toBe(200);
    expect(playlist.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(playlist.headers['cache-control']).toBe('no-store');
    expect(playlist.body).toBe('#EXTM3U\n');
    expect(segment.statusCode).toBe(200);
    expect(segment.headers['content-type']).toBe('video/mp2t');
  });

  it.each([
    ['a name FFmpeg never writes', 'passwd'],
    ['an encoded traversal', '..%2F..%2Fetc%2Fpasswd'],
    ['a segment not written yet', 'segment-00009.ts'],
  ])('answers 404 segment_not_found for %s', async (_case, file) => {
    const session = await hlsSession();

    const response = await app.inject({
      method: 'GET',
      url: `/playback/sessions/${session.sessionId}/${file}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error).toBe('segment_not_found');
  });

  it('closes the session on DELETE: FFmpeg killed, files gone, id forgotten', async () => {
    const session = await hlsSession();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/playback/sessions/${session.sessionId}`,
    });
    const after = await app.inject({ method: 'GET', url: session.url });
    const again = await app.inject({
      method: 'DELETE',
      url: `/playback/sessions/${session.sessionId}`,
    });

    expect(deleted.statusCode).toBe(204);
    expect(kills).toHaveBeenCalledTimes(1);
    expect(after.json<ApiError>().error).toBe('session_not_found');
    expect(again.statusCode).toBe(404);
  });

  it('accepts a heartbeat for a live session only', async () => {
    const session = await hlsSession();
    const url = (id: string) => `/playback/sessions/${id}/heartbeat`;

    const live = await app.inject({ method: 'POST', url: url(session.sessionId) });
    const unknown = await app.inject({ method: 'POST', url: url(randomUUID()) });

    expect(live.statusCode).toBe(204);
    expect(unknown.json<ApiError>().error).toBe('session_not_found');
  });

  it('answers 503 transcode_busy beyond one session', async () => {
    await hlsSession();
    const other = await scanned('Alien (1979).mkv');

    const response = await start(other.id, false);

    expect(response.statusCode).toBe(503);
    expect(response.json<ApiError>().error).toBe('transcode_busy');
  });

  it('kills every session when the server closes', async () => {
    await hlsSession();

    await app.close();

    expect(kills).toHaveBeenCalledTimes(1);
  });

  it('answers 422 not_playable for a file without video', async () => {
    const media = await scanned('Concert (2001).mkv');

    const response = await start(media.id, false);

    expect(response.statusCode).toBe(422);
    expect(response.json<ApiError>().error).toBe('not_playable');
  });

  it('answers 404 media_not_found for an unknown id or a file gone since the scan', async () => {
    const media = await scanned('Heat (1995).mkv');
    await unlink(join(root, 'Heat (1995).mkv'));

    expect((await start(randomUUID(), false)).json<ApiError>().error).toBe('media_not_found');
    expect((await start(media.id, false)).json<ApiError>().error).toBe('media_not_found');
  });

  it.each([
    ['POST', '/playback/sessions', { mediaId: 'x', directPlay: true }],
    ['POST', '/playback/sessions', { mediaId: randomUUID() }],
    ['POST', '/playback/sessions/not-a-uuid/heartbeat', undefined],
    ['DELETE', '/playback/sessions/not-a-uuid', undefined],
    ['GET', '/playback/sessions/not-a-uuid/index.m3u8', undefined],
  ] as const)('answers 400 to %s %s with invalid input', async (method, url, payload) => {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error).toBe('invalid_request');
  });
});
