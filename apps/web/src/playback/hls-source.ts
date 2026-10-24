const NATIVE_HLS = 'application/vnd.apple.mpegurl';

/**
 * Plays an HLS playlist in `video` (ADR-0006 §5): through hls.js wherever Media Source
 * Extensions exist, loaded on demand so the catalog bundle stays small; natively only
 * otherwise (iOS Safari). Recent Chromium answers `maybe` for native HLS without being
 * able to play it, so hls.js comes first. `onFatal` is called on an unrecoverable error.
 * Resolves to a cleanup function.
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  onFatal: () => void,
): Promise<() => void> {
  const { default: Hls } = await import('hls.js');
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) onFatal();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return () => hls.destroy();
  }
  if (video.canPlayType(NATIVE_HLS) !== '') {
    video.src = url;
    return () => video.removeAttribute('src');
  }
  onFatal();
  return () => undefined;
}
