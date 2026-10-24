import { describe, expect, it } from 'vitest';
import type { StreamInfo } from '@popcorntv/shared';
import { SEGMENT_PATTERN, ffmpegArgs } from './ffmpeg-args.js';

function stream(type: StreamInfo['type'], codec: string): StreamInfo {
  return { type, codec, width: null, height: null, language: null };
}

/** The value following `flag`, or undefined when the flag is absent. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('ffmpegArgs', () => {
  it('copies H.264 video and AAC audio (remux only)', () => {
    const args = ffmpegArgs('/m/a.mkv', [stream('video', 'h264'), stream('audio', 'aac')], '/t');

    expect(valueOf(args ?? [], '-c:v')).toBe('copy');
    expect(valueOf(args ?? [], '-c:a')).toBe('copy');
    expect(args).not.toContain('-vf');
  });

  it('re-encodes HEVC video to H.264 capped at 1080 lines and AC-3 audio to stereo AAC', () => {
    const args =
      ffmpegArgs('/m/a.mkv', [stream('video', 'HEVC'), stream('audio', 'ac3')], '/t') ?? [];

    expect(valueOf(args, '-c:v')).toBe('libx264');
    expect(valueOf(args, '-vf')).toBe("scale=-2:'trunc(min(1080,ih)/2)*2'");
    expect(valueOf(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*6)');
    expect(valueOf(args, '-c:a')).toBe('aac');
    expect(valueOf(args, '-ac')).toBe('2');
  });

  it('maps only the first video and first audio stream, in an EVENT playlist of 6 s segments', () => {
    const args =
      ffmpegArgs(
        '/m/a.mkv',
        [stream('audio', 'dts'), stream('video', 'h264'), stream('audio', 'aac')],
        '/t',
      ) ?? [];

    expect(args.filter((arg) => arg.startsWith('0:'))).toEqual(['0:V:0', '0:a:0']);
    expect(valueOf(args, '-c:a')).toBe('aac');
    expect(valueOf(args, '-hls_time')).toBe('6');
    expect(valueOf(args, '-hls_playlist_type')).toBe('event');
    expect(valueOf(args, '-hls_segment_filename')).toBe('/t/segment-%05d.ts');
    expect(args.at(-1)).toBe('/t/index.m3u8');
  });

  it('keeps a hostile file name as the value of -i', () => {
    const args = ffmpegArgs('-y.mkv', [stream('video', 'h264')], '/t') ?? [];

    expect(valueOf(args, '-i')).toBe('-y.mkv');
  });

  it('seeks the input before -i when resuming', () => {
    const args = ffmpegArgs('/m/a.mkv', [stream('video', 'h264')], '/t', 754) ?? [];

    expect(valueOf(args, '-ss')).toBe('754');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
  });

  it('adds no seek when starting from the beginning', () => {
    expect(ffmpegArgs('/m/a.mkv', [stream('video', 'h264')], '/t')).not.toContain('-ss');
  });

  it('maps no audio when the file has none', () => {
    const args = ffmpegArgs('/m/a.mkv', [stream('video', 'vp9')], '/t') ?? [];

    expect(args).not.toContain('0:a:0');
    expect(args).not.toContain('-c:a');
  });

  it('returns null without a video stream', () => {
    expect(ffmpegArgs('/m/a.mka', [stream('audio', 'aac')], '/t')).toBeNull();
  });

  it.each([
    ['segment-00000.ts', true],
    ['segment-12345.ts', true],
    ['segment-1.ts', false],
    ['../segment-00000.ts', false],
    ['segment-00000.ts.tmp', false],
  ])('accepts %s as a segment name: %s', (name, expected) => {
    expect(SEGMENT_PATTERN.test(name)).toBe(expected);
  });
});
