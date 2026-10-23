import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserCanPlay } from './can-play.js';

describe('browserCanPlay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks a video element for the browser's answer", () => {
    const canPlayType = vi
      .spyOn(HTMLMediaElement.prototype, 'canPlayType')
      .mockReturnValue('probably');

    expect(browserCanPlay('video/mp4; codecs="avc1.640028"')).toBe('probably');
    expect(canPlayType).toHaveBeenCalledWith('video/mp4; codecs="avc1.640028"');
  });
});
