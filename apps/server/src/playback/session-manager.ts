import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { StreamInfo } from '@popcorno/shared';
import { PLAYLIST_NAME, SEGMENT_PATTERN, ffmpegArgs } from './ffmpeg-args.js';
import type { TranscodeHandle, Transcoder } from './transcoder.js';

/** Tunables of the session lifecycle (state diagram 05); tests shorten them. */
export interface SessionManagerOptions {
  readonly transcoder: Transcoder;
  /** Parent of every session directory (`TRANSCODE_DIR`). */
  readonly dir: string;
  /** `TRANSCODE_MAX_SESSIONS`: beyond it `open` answers `busy` (spec R5). */
  readonly maxSessions: number;
  readonly logger: FastifyBaseLogger;
  /** Without any request for this long the session is closed (spec R4). */
  readonly idleMs?: number;
  /** FFmpeg must write the playlist within this delay (spec 3d). */
  readonly readyTimeoutMs?: number;
  readonly pollMs?: number;
}

/** Outcome of `open`. */
export type OpenResult =
  | { readonly kind: 'ready'; readonly id: string }
  | { readonly kind: 'not_playable' | 'busy' | 'failed' };

interface Session {
  readonly dir: string;
  readonly handle: TranscodeHandle;
  readonly timer: NodeJS.Timeout;
}

const IDLE_MS = 60_000;
const READY_TIMEOUT_MS = 20_000;
const POLL_MS = 200;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory HLS sessions (ADR-0006 §3): one FFmpeg process and one private temp
 * directory each, closed on demand, after `idleMs` without `touch`, or by `closeAll`.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly idleMs: number;
  private readonly readyTimeoutMs: number;
  private readonly pollMs: number;

  constructor(private readonly options: SessionManagerOptions) {
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? POLL_MS;
  }

  /** Starts FFmpeg on a confined real path and resolves once its playlist exists. */
  async open(inputPath: string, streams: readonly StreamInfo[]): Promise<OpenResult> {
    if (this.sessions.size >= this.options.maxSessions) return { kind: 'busy' };
    await mkdir(this.options.dir, { recursive: true });
    const dir = await mkdtemp(join(this.options.dir, 'session-'));
    const args = ffmpegArgs(inputPath, streams, dir);
    if (args === null) {
      await rm(dir, { recursive: true, force: true });
      return { kind: 'not_playable' };
    }
    const id = randomUUID();
    let exited = false;
    const handle = this.options.transcoder(args, (code, stderrTail) => {
      exited = true;
      if (code !== 0) this.options.logger.warn({ session: id, code, stderrTail }, 'ffmpeg failed');
    });
    const timer = setTimeout(() => void this.close(id), this.idleMs);
    // The slot is taken before awaiting, so two concurrent opens cannot both pass the limit.
    this.sessions.set(id, { dir, handle, timer });

    const deadline = Date.now() + this.readyTimeoutMs;
    const playlist = join(dir, PLAYLIST_NAME);
    const waitForPlaylist = async (): Promise<boolean> => {
      if (await exists(playlist)) return true;
      if (exited || Date.now() >= deadline || !this.sessions.has(id)) return false;
      await delay(this.pollMs);
      return waitForPlaylist();
    };
    if (await waitForPlaylist()) return { kind: 'ready', id };
    await this.close(id);
    return { kind: 'failed' };
  }

  /** Resets the idle timer; false for an unknown or closed session. */
  touch(id: string): boolean {
    const session = this.sessions.get(id);
    session?.timer.refresh();
    return session !== undefined;
  }

  /**
   * Absolute path of a playlist or segment of the session, or null when the name is not
   * one FFmpeg writes: no path is ever built from an unchecked URL segment.
   */
  filePath(id: string, name: string): string | null {
    const session = this.sessions.get(id);
    if (session === undefined) return null;
    if (name !== PLAYLIST_NAME && !SEGMENT_PATTERN.test(name)) return null;
    return join(session.dir, name);
  }

  /** Kills FFmpeg and removes the directory; false when the session was already gone. */
  async close(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (session === undefined) return false;
    this.sessions.delete(id);
    clearTimeout(session.timer);
    session.handle.kill();
    await rm(session.dir, { recursive: true, force: true });
    return true;
  }

  /** Server shutdown: every session is closed. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
