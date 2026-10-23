const NATIVE_HLS = 'application/vnd.apple.mpegurl';

/**
 * Plays an HLS playlist in `video` (ADR-0006 §5): natively where the browser can
 * (Safari), else through hls.js, loaded on demand so the catalog bundle stays small.
 * `onFatal` is called once on an unrecoverable error. Resolves to a cleanup function.
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  onFatal: () => void,
): Promise<() => void> {
  if (video.canPlayType(NATIVE_HLS) !== '') {
    video.src = url;
    return () => video.removeAttribute('src');
  }
  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) {
    onFatal();
    return () => undefined;
  }
  const hls = new Hls();
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) onFatal();
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}
