import { describe, expect, it } from 'vitest';
import type { StreamInfo } from './index.js';
import { decidePlayback, directPlayMime } from './playback.js';

function stream(type: StreamInfo['type'], codec: string): StreamInfo {
  return { type, codec, width: null, height: null, language: null };
}

const h264Aac = [stream('video', 'h264'), stream('audio', 'aac')];

describe('directPlayMime', () => {
  it('maps an MP4 H.264 + AAC file to its RFC 6381 MIME string', () => {
    expect(directPlayMime({ relativePath: 'Films/Heat (1995).mp4', streams: h264Aac })).toBe(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    );
  });

  it('treats .m4v as MP4 and ignores the extension case', () => {
    expect(directPlayMime({ relativePath: 'a.M4V', streams: h264Aac })).toBe(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    );
  });

  it('maps WebM VP9 + Opus and keeps only the first video and audio streams', () => {
    const streams = [
      stream('video', 'vp9'),
      stream('audio', 'opus'),
      stream('audio', 'dts'),
      stream('subtitle', 'webvtt'),
    ];
    expect(directPlayMime({ relativePath: 'b.webm', streams })).toBe(
      'video/webm; codecs="vp9, opus"',
    );
  });

  it('ignores the codec case and dots in the file name', () => {
    const streams = [stream('video', 'H264'), stream('audio', 'AAC')];
    expect(directPlayMime({ relativePath: 'Mr. Robot S01E01.v2.mp4', streams })).toBe(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    );
  });

  it('accepts a silent video', () => {
    expect(directPlayMime({ relativePath: 'c.mp4', streams: [stream('video', 'h264')] })).toBe(
      'video/mp4; codecs="avc1.640028"',
    );
  });

  it.each([
    ['an MKV container', 'd.mkv', h264Aac],
    ['no extension', 'README', h264Aac],
    ['a series row without file', null, []],
    ['no video stream', 'e.mp4', [stream('audio', 'aac')]],
    ['an unknown video codec', 'f.mp4', [stream('video', 'mpeg2video')]],
    ['an unknown audio codec', 'g.mp4', [stream('video', 'h264'), stream('audio', 'ac3')]],
    ['a codec of the other container', 'h.webm', h264Aac],
  ])('returns null for %s', (_label, relativePath, streams) => {
    expect(directPlayMime({ relativePath, streams })).toBeNull();
  });
});

describe('decidePlayback', () => {
  const media = { relativePath: 'a.mp4', streams: h264Aac };

  it.each(['probably', 'maybe'])('plays directly when the browser answers %s', (answer) => {
    const decision = decidePlayback(media, () => answer);
    expect(decision).toEqual({
      mode: 'direct',
      mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    });
  });

  it('is unsupported when the browser answers an empty string', () => {
    expect(decidePlayback(media, () => '')).toEqual({ mode: 'unsupported' });
  });

  it('never asks the browser about a file it cannot describe', () => {
    let asked = false;
    const decision = decidePlayback({ relativePath: 'a.avi', streams: h264Aac }, () => {
      asked = true;
      return 'probably';
    });
    expect(decision).toEqual({ mode: 'unsupported' });
    expect(asked).toBe(false);
  });
});
