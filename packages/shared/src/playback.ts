import type { Media, StreamInfo } from './index.js';

/** Outcome of the direct-play check (spec direct-play §2, ADR-0005). */
export type PlaybackDecision =
  { readonly mode: 'direct'; readonly mime: string } | { readonly mode: 'unsupported' };

/** The browser's answer for a MIME string: `HTMLVideoElement.canPlayType` in the web app. */
export type CanPlay = (mime: string) => string;

type Container = 'mp4' | 'webm';

const CONTAINERS: Readonly<Partial<Record<string, Container>>> = {
  mp4: 'mp4',
  m4v: 'mp4',
  webm: 'webm',
};

/** RFC 6381 codec strings per container; a codec missing here is never played directly. */
const CODECS: Readonly<Record<Container, Readonly<Partial<Record<string, string>>>>> = {
  mp4: {
    h264: 'avc1.640028',
    hevc: 'hvc1.1.6.L120.90',
    av1: 'av01.0.08M.08',
    vp9: 'vp09.00.40.08',
    aac: 'mp4a.40.2',
    mp3: 'mp4a.6B',
    opus: 'opus',
    flac: 'flac',
  },
  webm: { vp8: 'vp8', vp9: 'vp9', av1: 'av01.0.08M.08', opus: 'opus', vorbis: 'vorbis' },
};

const UNSUPPORTED: PlaybackDecision = { mode: 'unsupported' };

function containerOf(relativePath: string | null): Container | null {
  const extension = relativePath?.split('.').pop()?.toLowerCase() ?? '';
  return CONTAINERS[extension] ?? null;
}

function firstOfType(streams: readonly StreamInfo[], type: StreamInfo['type']): StreamInfo | null {
  return streams.find((stream) => stream.type === type) ?? null;
}

/**
 * The MIME string of a file the browser could decode without transcoding, or null: known
 * container from the extension, a video stream, and known codecs for the first video and
 * the first audio stream. Pure, so the server can reuse it for #8.
 */
export function directPlayMime(media: Pick<Media, 'relativePath' | 'streams'>): string | null {
  const container = containerOf(media.relativePath);
  if (container === null) return null;
  const video = firstOfType(media.streams, 'video');
  if (video === null) return null;
  const audio = firstOfType(media.streams, 'audio');
  const selected = audio === null ? [video] : [video, audio];
  const codecs = selected.map((stream) => CODECS[container][stream.codec.toLowerCase()]);
  if (codecs.includes(undefined)) return null;
  return `video/${container}; codecs="${codecs.join(', ')}"`;
}

/** Direct play when the browser answers `maybe` or `probably` for the file's MIME string. */
export function decidePlayback(
  media: Pick<Media, 'relativePath' | 'streams'>,
  canPlay: CanPlay,
): PlaybackDecision {
  const mime = directPlayMime(media);
  if (mime === null || canPlay(mime) === '') return UNSUPPORTED;
  return { mode: 'direct', mime };
}
