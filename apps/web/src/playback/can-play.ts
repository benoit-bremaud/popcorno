import type { CanPlay } from '@popcorno/shared';

let probe: HTMLVideoElement | null = null;

/** The browser's own decoder check (`HTMLVideoElement.canPlayType`), spec direct-play §2. */
export const browserCanPlay: CanPlay = (mime) => {
  // One detached element answers every call: a series detail asks once per episode.
  probe ??= document.createElement('video');
  return probe.canPlayType(mime);
};
