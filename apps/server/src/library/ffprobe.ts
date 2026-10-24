import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StreamInfo } from '@popcorno/shared';

const execFileAsync = promisify(execFile);

/** What the scanner needs from a file: duration and its streams. */
export interface ProbeResult {
  readonly durationSec: number | null;
  readonly streams: readonly StreamInfo[];
}

/**
 * Single process egress of the library domain (component diagram): injected into the
 * scanner. Rejects when ffprobe exits non-zero, times out or prints invalid JSON.
 */
export type Prober = (filePath: string) => Promise<ProbeResult>;

interface FfprobeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly tags?: { readonly language?: string };
  readonly disposition?: { readonly attached_pic?: number };
}

interface FfprobeOutput {
  readonly format?: { readonly duration?: string };
  readonly streams?: readonly FfprobeStream[];
}

const PROBE_TIMEOUT_MS = 30_000;
/** ffprobe JSON for a file with many streams stays well under this. */
const PROBE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Builds a prober that runs `ffprobe -print_format json` on each file. The path is
 * passed as the `-i` argument, so a name starting with `-` cannot become an option.
 */
export function createFfprobe(ffprobePath: string): Prober {
  return async (filePath) => {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', filePath],
      { timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: PROBE_MAX_OUTPUT_BYTES },
    );
    return parseFfprobeOutput(JSON.parse(stdout) as FfprobeOutput);
  };
}

/** Pure mapping from ffprobe's JSON to the domain shape; exported for its own tests. */
export function parseFfprobeOutput(output: FfprobeOutput): ProbeResult {
  const duration = Number(output.format?.duration);
  const streams: StreamInfo[] = [];
  for (const stream of output.streams ?? []) {
    const type = stream.codec_type;
    if (type !== 'video' && type !== 'audio' && type !== 'subtitle') continue;
    // Cover art is a still picture, not the title's video (FFmpeg maps `0:V:0` too).
    if (stream.disposition?.attached_pic === 1) continue;
    streams.push({
      type,
      codec: stream.codec_name ?? 'unknown',
      width: stream.width ?? null,
      height: stream.height ?? null,
      language: stream.tags?.language ?? null,
    });
  }
  return { durationSec: Number.isFinite(duration) ? Math.round(duration) : null, streams };
}
