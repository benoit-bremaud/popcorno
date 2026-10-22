import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StreamInfo } from '@popcorno/shared';

const execFileAsync = promisify(execFile);

/** What the scanner needs from a file: duration and its streams. */
export interface ProbeResult {
  readonly durationSec: number | null;
  readonly streams: readonly StreamInfo[];
}

/** Single process egress of the library domain (component diagram): injected into the scanner. */
export type Prober = (filePath: string) => Promise<ProbeResult>;

interface FfprobeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly tags?: { readonly language?: string };
}

interface FfprobeOutput {
  readonly format?: { readonly duration?: string };
  readonly streams?: readonly FfprobeStream[];
}

const PROBE_TIMEOUT_MS = 30_000;

/** Builds a prober that runs `ffprobe -print_format json` on each file. */
export function createFfprobe(ffprobePath: string): Prober {
  return async (filePath) => {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
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
