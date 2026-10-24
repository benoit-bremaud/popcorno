import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  offsetSec: 0,
};
const DIRECT: PlaybackStart = {
  mode: 'direct',
  url: '/api/media/heat/file',
  mime: 'video/mp4',
  offsetSec: 0,
};
const heat = media({ id: 'heat', title: 'Heat' });

function fakeApi(result: Awaited<ReturnType<PlaybackApi['start']>>) {
  return {
    start: vi.fn(async () => result),
    heartbeat: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
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
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith('s1'));
  });

  it('detaches hls.js when it unmounts, leaving the session to close or the watchdog', async () => {
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
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    await act(async () => undefined);

    unmount();

    expect(detach).toHaveBeenCalledOnce();
    expect(api.stop).not.toHaveBeenCalled();
  });

  it('starts one session only, even when effects run twice (StrictMode)', async () => {
    const api = fakeApi(HLS);
    render(
      <StrictMode>
        <PlayerDialog
          item={heat}
          directPlay={false}
          onClose={vi.fn()}
          api={api}
          attach={async () => () => undefined}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

    expect(api.start).toHaveBeenCalledOnce();
    expect(api.stop).not.toHaveBeenCalled();
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

  it('stops the heartbeat once unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = fakeApi(HLS);
    const { unmount } = render(
      <PlayerDialog
        item={heat}
        directPlay={false}
        onClose={vi.fn()}
        api={api}
        attach={async () => () => undefined}
      />,
    );
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

    unmount();
    vi.advanceTimersByTime(60_000);

    expect(api.heartbeat).not.toHaveBeenCalled();
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
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith('s1'));
  });

  it('fails when the hls.js chunk cannot be loaded', async () => {
    const api = fakeApi(HLS);
    render(
      <PlayerDialog
        item={heat}
        directPlay={false}
        onClose={vi.fn()}
        api={api}
        attach={async () => {
          throw new TypeError('Failed to fetch dynamically imported module');
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('This file could not be played.');
  });

  it('tells the viewer when another title holds the transcoder', async () => {
    render(<PlayerDialog item={heat} directPlay={false} onClose={vi.fn()} api={fakeApi('busy')} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another title is being transcoded. Try again later.',
    );
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

  it('ends a session that was still starting when the player closed', async () => {
    let resolve: (start: PlaybackStart) => void = () => undefined;
    const api = {
      ...fakeApi(HLS),
      start: vi.fn(() => new Promise<PlaybackStart>((done) => (resolve = done))),
    };
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PlayerDialog item={heat} directPlay={false} onClose={onClose} api={api} />);

    await user.click(screen.getByRole('button', { name: 'Close player' }));
    await act(async () => resolve(HLS));

    expect(onClose).toHaveBeenCalledOnce();
    expect(api.stop).toHaveBeenCalledWith('s1');
  });

  it('has no session to end for direct play', async () => {
    const api = fakeApi(DIRECT);
    const user = userEvent.setup();
    render(<PlayerDialog item={heat} directPlay onClose={vi.fn()} api={api} />);
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Close player' }));

    expect(api.stop).not.toHaveBeenCalled();
  });
});

async function videoOf(): Promise<HTMLVideoElement> {
  await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
  return document.querySelector('video') as HTMLVideoElement;
}

describe('PlayerDialog resume and progress', () => {
  it('asks for the resume offset and seeks a direct-played file to it', async () => {
    const api = fakeApi(DIRECT);
    render(<PlayerDialog item={heat} directPlay startSec={754} onClose={vi.fn()} api={api} />);
    const element = await videoOf();

    fireEvent.loadedMetadata(element);

    expect(api.start).toHaveBeenCalledWith('heat', true, 754);
    expect(element.currentTime).toBe(754);
  });

  it('does not seek an HLS stream that already starts at the offset, and saves absolute time', async () => {
    const api = fakeApi({ ...HLS, offsetSec: 754 });
    render(
      <PlayerDialog
        item={heat}
        directPlay={false}
        startSec={754}
        onClose={vi.fn()}
        api={api}
        attach={async () => () => undefined}
      />,
    );
    const element = await videoOf();

    fireEvent.loadedMetadata(element);
    expect(element.currentTime).toBe(0);
    element.currentTime = 12.7;
    fireEvent.pause(element);

    expect(api.save).toHaveBeenCalledWith('heat', 766);
  });

  it('saves the position when the player closes', async () => {
    const api = fakeApi(DIRECT);
    const user = userEvent.setup();
    render(<PlayerDialog item={heat} directPlay onClose={vi.fn()} api={api} />);
    const element = await videoOf();
    element.currentTime = 30;

    await user.click(screen.getByRole('button', { name: 'Close player' }));

    expect(api.save).toHaveBeenCalledWith('heat', 30);
  });

  it('saves every 10 s while playing, not while paused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi(DIRECT);
    render(<PlayerDialog item={heat} directPlay onClose={vi.fn()} api={api} />);
    const element = await videoOf();
    let paused = true;
    Object.defineProperty(element, 'paused', { get: () => paused });
    element.currentTime = 5;

    act(() => vi.advanceTimersByTime(10_000));
    expect(api.save).not.toHaveBeenCalled();
    paused = false;
    act(() => vi.advanceTimersByTime(10_000));

    expect(api.save).toHaveBeenCalledWith('heat', 5);
  });
});

describe('PlayerDialog next episode', () => {
  const episode = media({ id: 'e1', title: 'Pilot', kind: 'episode', durationSec: 100 });
  const following = media({ id: 'e2', title: 'Second', kind: 'episode', durationSec: 100 });

  it('offers the next episode at 90 %, then ends this session and plays it', async () => {
    const api = fakeApi(HLS);
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <PlayerDialog
        item={episode}
        directPlay={false}
        next={following}
        onNext={onNext}
        onClose={vi.fn()}
        api={api}
        attach={async () => () => undefined}
      />,
    );
    const element = await videoOf();
    element.currentTime = 89;
    fireEvent.timeUpdate(element);
    expect(screen.queryByRole('button', { name: /Next episode/ })).toBeNull();

    element.currentTime = 90;
    fireEvent.timeUpdate(element);
    await user.click(screen.getByRole('button', { name: 'Next episode: Second ▶' }));

    expect(api.save).toHaveBeenCalledWith('e1', 90);
    expect(api.stop).toHaveBeenCalledWith('s1');
    expect(onNext).toHaveBeenCalledWith(following);
  });

  it('offers it when the video ends, even without a known duration', async () => {
    render(
      <PlayerDialog
        item={{ ...episode, durationSec: null }}
        directPlay
        next={following}
        onClose={vi.fn()}
        api={fakeApi(DIRECT)}
      />,
    );
    const element = await videoOf();

    fireEvent.ended(element);

    expect(screen.getByRole('button', { name: 'Next episode: Second ▶' })).toBeInTheDocument();
  });

  it('offers nothing after the last episode', async () => {
    render(<PlayerDialog item={episode} directPlay onClose={vi.fn()} api={fakeApi(DIRECT)} />);
    const element = await videoOf();
    element.currentTime = 99;

    fireEvent.timeUpdate(element);
    fireEvent.ended(element);

    expect(screen.queryByRole('button', { name: /Next episode/ })).toBeNull();
  });
});
