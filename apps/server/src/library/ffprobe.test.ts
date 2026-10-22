import { describe, expect, it } from 'vitest';
import { parseFfprobeOutput } from './ffprobe.js';

describe('parseFfprobeOutput', () => {
  it('maps duration and the three stream types, ignoring the rest', () => {
    const result = parseFfprobeOutput({
      format: { duration: '7260.48' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
        { codec_type: 'audio', codec_name: 'aac', tags: { language: 'fre' } },
        { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
        { codec_type: 'attachment', codec_name: 'ttf' },
      ],
    });

    expect(result).toEqual({
      durationSec: 7260,
      streams: [
        { type: 'video', codec: 'h264', width: 1920, height: 1080, language: null },
        { type: 'audio', codec: 'aac', width: null, height: null, language: 'fre' },
        { type: 'subtitle', codec: 'subrip', width: null, height: null, language: 'eng' },
      ],
    });
  });

  it('tolerates a missing format block and unnamed codecs', () => {
    expect(parseFfprobeOutput({ streams: [{ codec_type: 'video' }] })).toEqual({
      durationSec: null,
      streams: [{ type: 'video', codec: 'unknown', width: null, height: null, language: null }],
    });
    expect(parseFfprobeOutput({})).toEqual({ durationSec: null, streams: [] });
  });
});
