import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachHls } from './hls-source.js';

type ErrorHandler = (event: string, data: { fatal: boolean }) => void;

/** hls.js is the third-party boundary: replaced by a recording double. */
const hlsState = vi.hoisted(() => ({
  supported: true,
  instances: [] as {
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    onError: ErrorHandler | null;
  }[],
}));

vi.mock('hls.js', () => {
  class FakeHls {
    static readonly Events = { ERROR: 'hlsError' };
    static isSupported(): boolean {
      return hlsState.supported;
    }
    readonly loadSource = vi.fn();
    readonly attachMedia = vi.fn();
    readonly destroy = vi.fn();
    onError: ErrorHandler | null = null;
    constructor() {
      hlsState.instances.push(this);
    }
    on(_event: string, handler: ErrorHandler): void {
      this.onError = handler;
    }
  }
  return { default: FakeHls };
});

function video(nativeHls: boolean): HTMLVideoElement {
  const element = document.createElement('video');
  element.canPlayType = () => (nativeHls ? 'maybe' : '');
  return element;
}

afterEach(() => {
  hlsState.instances.length = 0;
  hlsState.supported = true;
});

describe('attachHls', () => {
  it('falls back to native HLS without MSE (iOS Safari)', async () => {
    hlsState.supported = false;
    const element = video(true);

    const detach = await attachHls(element, '/p.m3u8', vi.fn());

    expect(element.getAttribute('src')).toBe('/p.m3u8');
    expect(hlsState.instances).toHaveLength(0);
    detach();
    expect(element.hasAttribute('src')).toBe(false);
  });

  it('prefers hls.js when MSE exists, even if native HLS is claimed', async () => {
    const element = video(true);

    const detach = await attachHls(element, '/p.m3u8', vi.fn());

    const [hls] = hlsState.instances;
    expect(hls?.loadSource).toHaveBeenCalledWith('/p.m3u8');
    expect(hls?.attachMedia).toHaveBeenCalledWith(element);
    expect(element.hasAttribute('src')).toBe(false);
    detach();
    expect(hls?.destroy).toHaveBeenCalledOnce();
  });

  it('reports fatal errors only', async () => {
    const onFatal = vi.fn();
    await attachHls(video(false), '/p.m3u8', onFatal);
    const [hls] = hlsState.instances;

    hls?.onError?.('hlsError', { fatal: false });
    hls?.onError?.('hlsError', { fatal: true });

    expect(onFatal).toHaveBeenCalledOnce();
  });

  it('fails at once when neither native HLS nor MSE is available', async () => {
    hlsState.supported = false;
    const onFatal = vi.fn();

    await attachHls(video(false), '/p.m3u8', onFatal);

    expect(onFatal).toHaveBeenCalledOnce();
    expect(hlsState.instances).toHaveLength(0);
  });
});
