import { writeFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { StreamInfo } from '@popcorno/shared';
import { SessionManager } from './session-manager.js';
import type { SessionManagerOptions } from './session-manager.js';
import type { ExitListener, Transcoder } from './transcoder.js';

const HEVC: readonly StreamInfo[] = [
  { type: 'video', codec: 'hevc', width: 3840, height: 2160, language: null },
];

/** A transcoder double: records each run, optionally writes the playlist like FFmpeg. */
function fakeTranscoder(behaviour: 'writes' | 'silent' | 'crashes') {
  const kills = vi.fn();
  const runs: { args: readonly string[]; onExit: ExitListener }[] = [];
  const transcoder: Transcoder = (args, onExit) => {
    runs.push({ args, onExit });
    const playlist = args.at(-1) ?? '';
    if (behaviour === 'writes') writeFileSync(playlist, '#EXTM3U\n');
    if (behaviour === 'crashes') queueMicrotask(() => onExit(1, 'Invalid data found'));
    return { kill: kills };
  };
  return { transcoder, kills, runs };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('SessionManager', () => {
  let dir: string;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'popcorno-sessions-')), 'transcode');
    warn = vi.fn();
  });

  afterEach(async () => {
    await rm(dirname(dir), { recursive: true, force: true });
  });

  function manager(transcoder: Transcoder, overrides: Partial<SessionManagerOptions> = {}) {
    return new SessionManager({
      transcoder,
      dir,
      maxSessions: 1,
      logger: { warn } as unknown as FastifyBaseLogger,
      pollMs: 5,
      ...overrides,
    });
  }

  it('opens a session once FFmpeg has written the playlist, in its own directory', async () => {
    const { transcoder, runs } = fakeTranscoder('writes');
    const sessions = manager(transcoder);

    const result = await sessions.open('/m/a.mkv', HEVC);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    const playlist = sessions.filePath(result.id, 'index.m3u8') ?? '';
    expect(await exists(playlist)).toBe(true);
    expect(runs[0]?.args).toContain('/m/a.mkv');
    expect(dirname(playlist).startsWith(join(dir, 'session-'))).toBe(true);
    await sessions.closeAll();
  });

  it('answers busy beyond the limit, and frees the slot on close', async () => {
    const sessions = manager(fakeTranscoder('writes').transcoder);
    const first = await sessions.open('/m/a.mkv', HEVC);

    expect((await sessions.open('/m/b.mkv', HEVC)).kind).toBe('busy');
    if (first.kind === 'ready') await sessions.close(first.id);
    expect((await sessions.open('/m/b.mkv', HEVC)).kind).toBe('ready');
    await sessions.closeAll();
  });

  it('fails and cleans up when FFmpeg exits before writing the playlist', async () => {
    const { transcoder, kills } = fakeTranscoder('crashes');
    const sessions = manager(transcoder);

    expect((await sessions.open('/m/a.mkv', HEVC)).kind).toBe('failed');
    expect(kills).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 1, stderrTail: 'Invalid data found' }),
      'ffmpeg failed',
    );
  });

  it('fails when no playlist appears before the ready timeout', async () => {
    const sessions = manager(fakeTranscoder('silent').transcoder, { readyTimeoutMs: 30 });

    expect((await sessions.open('/m/a.mkv', HEVC)).kind).toBe('failed');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a file without video before spawning anything', async () => {
    const { transcoder, runs } = fakeTranscoder('writes');
    const sessions = manager(transcoder);

    const result = await sessions.open('/m/a.mka', [
      { type: 'audio', codec: 'aac', width: null, height: null, language: null },
    ]);

    expect(result.kind).toBe('not_playable');
    expect(runs).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('closes a session after the idle delay, unless touched', async () => {
    const { transcoder, kills } = fakeTranscoder('writes');
    const sessions = manager(transcoder, { idleMs: 60_000 });
    let id = '';
    // Only the global timers are faked: `open` polls with `timers/promises`, left real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const result = await sessions.open('/m/a.mkv', HEVC);
      if (result.kind !== 'ready') throw new Error('not ready');
      id = result.id;
      await vi.advanceTimersByTimeAsync(50_000);
      expect(sessions.touch(id)).toBe(true);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(sessions.touch(id)).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));

    expect(sessions.touch(id)).toBe(false);
    expect(kills).toHaveBeenCalledTimes(1);
  });

  it('only resolves the names FFmpeg writes', async () => {
    const sessions = manager(fakeTranscoder('writes').transcoder);
    const result = await sessions.open('/m/a.mkv', HEVC);
    if (result.kind !== 'ready') throw new Error('not ready');

    expect(sessions.filePath(result.id, 'segment-00003.ts')).toMatch(/segment-00003\.ts$/);
    expect(sessions.filePath(result.id, '../../etc/passwd')).toBeNull();
    expect(sessions.filePath(result.id, 'index.m3u8.tmp')).toBeNull();
    expect(sessions.filePath('unknown', 'index.m3u8')).toBeNull();
    await sessions.closeAll();
  });

  it('lets only one of two concurrent opens take the single slot', async () => {
    const { transcoder, runs } = fakeTranscoder('writes');
    const sessions = manager(transcoder);

    const results = await Promise.all([
      sessions.open('/m/a.mkv', HEVC),
      sessions.open('/m/b.mkv', HEVC),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(['busy', 'ready']);
    expect(runs).toHaveLength(1);
    await sessions.closeAll();
  });

  it('closes a ready session whose FFmpeg crashes, freeing the slot', async () => {
    const { transcoder, runs, kills } = fakeTranscoder('writes');
    const sessions = manager(transcoder);
    const result = await sessions.open('/m/a.mkv', HEVC);
    if (result.kind !== 'ready') throw new Error('not ready');

    runs[0]?.onExit(1, 'Conversion failed');

    expect(sessions.touch(result.id)).toBe(false);
    expect(kills).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
    expect(warn).toHaveBeenCalledOnce();
  });

  it('logs nothing when its own close kills FFmpeg', async () => {
    const { transcoder, runs } = fakeTranscoder('writes');
    const sessions = manager(transcoder);
    const result = await sessions.open('/m/a.mkv', HEVC);
    if (result.kind !== 'ready') throw new Error('not ready');

    await sessions.close(result.id);
    runs[0]?.onExit(null, '');

    expect(warn).not.toHaveBeenCalled();
  });

  it('fails cleanly when FFmpeg cannot even be spawned', async () => {
    const error = vi.fn();
    const sessions = new SessionManager({
      transcoder: () => {
        throw new Error('EAGAIN');
      },
      dir,
      maxSessions: 1,
      logger: { warn, error } as unknown as FastifyBaseLogger,
    });

    expect((await sessions.open('/m/a.mkv', HEVC)).kind).toBe('failed');
    expect(await readdir(dir)).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
  });

  it('cleans only the session directories a previous run left', async () => {
    await mkdir(join(dir, 'session-old'), { recursive: true });
    await mkdir(join(dir, 'keep-me'));
    const sessions = manager(fakeTranscoder('writes').transcoder);

    await sessions.clean();

    expect(await readdir(dir)).toEqual(['keep-me']);
  });

  it('cleans nothing when the directory does not exist yet', async () => {
    await expect(manager(fakeTranscoder('writes').transcoder).clean()).resolves.toBeUndefined();
  });

  it('reports a second close as already gone', async () => {
    const { transcoder, kills } = fakeTranscoder('writes');
    const sessions = manager(transcoder);
    const result = await sessions.open('/m/a.mkv', HEVC);
    if (result.kind !== 'ready') throw new Error('not ready');

    expect(await sessions.close(result.id)).toBe(true);
    expect(await sessions.close(result.id)).toBe(false);
    expect(kills).toHaveBeenCalledTimes(1);
  });
});
