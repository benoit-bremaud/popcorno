import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackStart } from '@popcorno/shared';
import { media } from '../test-fixtures.js';
import { PlayerDialog } from './PlayerDialog.js';
import type { PlaybackApi } from './PlayerDialog.js';

const HLS: PlaybackStart = {
  mode: 'hls',
  sessionId: 's1',
  url: '/api/playback/sessions/s1/index.m3u8',
};
const heat = media({ id: 'heat', title: 'Heat' });

function fakeApi(result: Awaited<ReturnType<PlaybackApi['start']>>) {
  return {
    start: vi.fn(async () => result),
    heartbeat: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PlayerDialog over HLS', () => {
  it('attaches the playlist, then detaches and ends the session on close', async () => {
    const api = fakeApi(HLS);
    const detach = vi.fn();
    const attach = vi.fn(async () => detach);
    const user = userEvent.setup();
    render(
      <PlayerDialog item={heat} directPlay={false} onClose={vi.fn()} api={api} attach={attach} />,
    );

    await waitFor(() => expect(attach).toHaveBeenCalledOnce());
    const [video, url] = attach.mock.calls[0] as unknown as [HTMLVideoElement, string];
    expect(video.tagName).toBe('VIDEO');
    expect(video.hasAttribute('src')).toBe(false);
    expect(url).toBe(HLS.url);

    await user.click(screen.getByRole('button', { name: 'Close player' }));
    expect(api.stop).not.toHaveBeenCalled(); // the caller unmounts the player on `close`
  });

  it('ends the session and detaches hls.js when it unmounts', async () => {
    const api = fakeApi(HLS);
    const detach = vi.fn();
    const { unmount } = render(
      <PlayerDialog
        item={heat}
        directPlay={false}
        onClose={vi.fn()}
        api={api}
        attach={async () => detach}
      />,
    );
    await screen.findByLabelText('Playing Heat');
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    await act(async () => undefined);

    unmount();

    expect(api.stop).toHaveBeenCalledWith('s1');
    expect(detach).toHaveBeenCalledOnce();
  });

  it('sends a heartbeat every 20 s while open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = fakeApi(HLS);
    render(
      <PlayerDialog
        item={heat}
        directPlay={false}
        onClose={vi.fn()}
        api={api}
        attach={async () => () => undefined}
      />,
    );
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

    vi.advanceTimersByTime(40_000);

    expect(api.heartbeat).toHaveBeenCalledTimes(2);
    expect(api.heartbeat).toHaveBeenCalledWith('s1');
  });

  it('shows the failure message when hls.js reports a fatal error', async () => {
    const api = fakeApi(HLS);
    render(
      <PlayerDialog
        item={heat}
        directPlay={false}
        onClose={vi.fn()}
        api={api}
        attach={async (_video, _url, onFatal) => {
          onFatal();
          return () => undefined;
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('This file could not be played.');
  });

  it('shows a status while the server prepares the stream', () => {
    const api = { ...fakeApi(HLS), start: vi.fn(() => new Promise<never>(() => undefined)) };
    render(<PlayerDialog item={heat} directPlay={false} onClose={vi.fn()} api={api} />);

    expect(screen.getByRole('status')).toHaveTextContent('Preparing playback…');
  });

  it('shows the failure message when the server cannot start', async () => {
    render(
      <PlayerDialog item={heat} directPlay={false} onClose={vi.fn()} api={fakeApi('failed')} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('This file could not be played.');
  });

  it('ends a session that started after the player was closed', async () => {
    let resolve: (start: PlaybackStart) => void = () => undefined;
    const api = {
      ...fakeApi(HLS),
      start: vi.fn(() => new Promise<PlaybackStart>((done) => (resolve = done))),
    };
    const { unmount } = render(
      <PlayerDialog item={heat} directPlay={false} onClose={vi.fn()} api={api} />,
    );

    unmount();
    await act(async () => resolve(HLS));

    expect(api.stop).toHaveBeenCalledWith('s1');
  });
});
