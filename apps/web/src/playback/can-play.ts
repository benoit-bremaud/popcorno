import type { CanPlay } from '@popcorno/shared';

/** The browser's own decoder check (`HTMLVideoElement.canPlayType`), spec direct-play §2. */
export const browserCanPlay: CanPlay = (mime) => document.createElement('video').canPlayType(mime);
