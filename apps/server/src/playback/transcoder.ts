import { spawn as nodeSpawn } from 'node:child_process';

/** A running FFmpeg process, as the session manager sees it. */
export interface TranscodeHandle {
  /** SIGKILL; safe to call after exit. */
  kill(): void;
}

/** Called once when the process ends: exit code (null when killed) and the stderr tail. */
export type ExitListener = (code: number | null, stderrTail: string) => void;

/**
 * Single child-process egress of the playback domain (component diagram, ADR-0006):
 * injected into the session manager so tests never run FFmpeg. `onExit` is called exactly
 * once, also when the binary cannot start (code null).
 */
export type Transcoder = (args: readonly string[], onExit: ExitListener) => TranscodeHandle;

/** `child_process.spawn`, injected by the transcoder's tests. */
export type Spawn = typeof nodeSpawn;

/** FFmpeg errors are short; keep only the end so a chatty failure cannot grow memory. */
const STDERR_TAIL_BYTES = 2048;

/** Builds a transcoder running `ffmpegPath` without a shell, stdout ignored, stderr tailed. */
export function createTranscoder(ffmpegPath: string, spawn: Spawn = nodeSpawn): Transcoder {
  return (args, onExit) => {
    const child = spawn(ffmpegPath, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    let done = false;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      onExit(code, tail);
    };
    child.stderr?.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    // `error` covers a missing binary (ENOENT): no `exit` follows it.
    child.on('error', (error) => {
      tail = error.message;
      finish(null);
    });
    child.on('exit', (code) => finish(code));
    return {
      kill: () => {
        if (!done) child.kill('SIGKILL');
      },
    };
  };
}
