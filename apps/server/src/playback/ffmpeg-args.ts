import { join } from 'node:path';
import type { StreamInfo } from '@popcorntv/shared';

/** Playlist and segment names FFmpeg writes in a session directory (spec hls-transcode §2.3). */
export const PLAYLIST_NAME = 'index.m3u8';
/** The only segment names ever joined to a session directory. */
export const SEGMENT_PATTERN = /^segment-\d{5}\.ts$/;
const SEGMENT_TEMPLATE = 'segment-%05d.ts';
const SEGMENT_SECONDS = 6;

/** Codecs every HLS player decodes; anything else is re-encoded (ADR-0006 §1). */
const COPY_VIDEO = new Set(['h264']);
const COPY_AUDIO = new Set(['aac', 'mp3']);

function first(streams: readonly StreamInfo[], type: StreamInfo['type']): StreamInfo | null {
  return streams.find((stream) => stream.type === type) ?? null;
}

function videoArgs(video: StreamInfo): string[] {
  if (COPY_VIDEO.has(video.codec.toLowerCase())) return ['-c:v', 'copy'];
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    // Never upscale, cap at 1080 lines; yuv420p needs even width and height.
    '-vf',
    "scale=-2:'trunc(min(1080,ih)/2)*2'",
    // A keyframe at every segment boundary, so segments start decodable.
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
  ];
}

function audioArgs(audio: StreamInfo): string[] {
  if (COPY_AUDIO.has(audio.codec.toLowerCase())) return ['-c:a', 'copy'];
  return ['-c:a', 'aac', '-b:a', '160k', '-ac', '2'];
}

/**
 * FFmpeg arguments turning the first video and first audio stream of `inputPath` into an
 * HLS EVENT playlist in `outputDir`: copied when HLS-safe, re-encoded otherwise. Pure.
 * The input is the argument of `-i`, so a name starting with `-` cannot become an option.
 * `startSec > 0` seeks the input before `-i` (fast, lands on the previous keyframe) so a
 * resume starts there (ADR-0007 §2). Null when there is no video stream.
 */
export function ffmpegArgs(
  inputPath: string,
  streams: readonly StreamInfo[],
  outputDir: string,
  startSec = 0,
): string[] | null {
  const video = first(streams, 'video');
  if (video === null) return null;
  const audio = first(streams, 'audio');
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i',
    inputPath,
    // Capital V skips attached pictures (cover art stored as a video stream).
    '-map',
    '0:V:0',
    ...(audio === null ? [] : ['-map', '0:a:0']),
    ...videoArgs(video),
    ...(audio === null ? [] : audioArgs(audio)),
    '-sn',
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    // FFmpeg renames the playlist into place: "exists" means "complete" for the poller.
    '-hls_flags',
    'temp_file',
    '-hls_segment_filename',
    join(outputDir, SEGMENT_TEMPLATE),
    join(outputDir, PLAYLIST_NAME),
  ];
}
