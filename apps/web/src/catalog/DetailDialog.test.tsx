import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CanPlay, Media, StreamInfo, WatchProgress } from '@popcorno/shared';
import type { PlaybackApi } from '../playback/PlayerDialog.js';
import { media } from '../test-fixtures.js';
import { DetailDialog } from './DetailDialog.js';
import type { Season } from './catalog.js';

const H264_AAC: StreamInfo[] = [
  { type: 'video', codec: 'h264', width: 1920, height: 1080, language: null },
  { type: 'audio', codec: 'aac', width: null, height: null, language: 'eng' },
];

const heat = media({ id: 'heat', title: 'Heat', relativePath: 'Heat.mp4', streams: H264_AAC });
const always: CanPlay = () => 'probably';

/** A server double: confirms direct play when asked, answers busy for HLS (no hls.js here). */
function fakeApi(): PlaybackApi & { start: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn(async (mediaId: string, directPlay: boolean) =>
      directPlay
        ? {
            mode: 'direct' as const,
            url: `/api/media/${mediaId}/file`,
            mime: 'video/mp4',
            offsetSec: 0,
          }
        : ('busy' as const),
    ),
    heartbeat: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  };
}

function renderDetail(
  item: Media,
  canPlay: CanPlay = always,
  onClose = vi.fn(),
  saved: readonly WatchProgress[] = [],
  seasons: readonly Season[] = [],
) {
  const api = fakeApi();
  const progress = vi.fn(async () => [...saved]);
  return {
    user: userEvent.setup(),
    onClose,
    api,
    ...render(
      <DetailDialog
        item={item}
        seasons={seasons}
        onClose={onClose}
        canPlay={canPlay}
        api={api}
        progress={progress}
      />,
    ),
  };
}

describe('DetailDialog playback', () => {
  it('plays a direct-playable film in a native video and returns focus to Play', async () => {
    const { user, onClose } = renderDetail(heat);

    const play = screen.getByRole('button', { name: '▶ Play' });
    await user.click(play);

    const player = screen.getByRole('dialog', { name: 'Playing Heat' });
    await waitFor(() => expect(player.querySelector('video')).not.toBeNull());
    const video = player.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/api/media/heat/file');
    expect(video?.controls).toBe(true);

    await user.click(within(player).getByRole('button', { name: 'Close player' }));
    expect(screen.queryByRole('dialog', { name: 'Playing Heat' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Heat' })).toBeInTheDocument();
    expect(play).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error in the player when the file cannot be decoded', async () => {
    const { user } = renderDetail(heat);
    await user.click(screen.getByRole('button', { name: '▶ Play' }));

    const player = screen.getByRole('dialog', { name: 'Playing Heat' });
    const video = await waitFor(() => {
      const element = player.querySelector('video');
      if (element === null) throw new Error('no video yet');
      return element;
    });
    fireEvent.error(video);

    expect(within(player).getByRole('alert')).toHaveTextContent('This file could not be played.');
  });

  it('plays a file the browser cannot decode by asking the server for HLS', async () => {
    const { user, api } = renderDetail(heat, () => '');

    await user.click(screen.getByRole('button', { name: '▶ Play' }));

    expect(api.start).toHaveBeenCalledWith('heat', false, 0);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another title is being transcoded. Try again later.',
    );
  });

  it('offers Play for an MKV, left to HLS (#8)', async () => {
    const { user, api } = renderDetail(media({ id: 'mkv', title: 'Mkv', streams: H264_AAC }));

    await user.click(screen.getByRole('button', { name: '▶ Play' }));

    expect(api.start).toHaveBeenCalledWith('mkv', false, 0);
  });

  it('offers no Play button for a file without video', () => {
    renderDetail(media({ id: 'cd', title: 'Score', streams: [] }));

    expect(screen.queryByRole('button', { name: '▶ Play' })).not.toBeInTheDocument();
  });

  it('plays an episode from its season list, not the series row', async () => {
    const dark = media({ id: 'dark', title: 'Dark', kind: 'series', relativePath: null });
    const pilot = media({
      id: 'pilot',
      title: 'Secrets',
      kind: 'episode',
      relativePath: 'Dark/S01E01.mp4',
      streams: H264_AAC,
      seriesId: 'dark',
      season: 1,
      episode: 1,
    });
    const user = userEvent.setup();
    render(
      <DetailDialog
        item={dark}
        seasons={[{ season: 1, episodes: [pilot] }]}
        onClose={vi.fn()}
        canPlay={always}
        api={fakeApi()}
      />,
    );

    expect(screen.queryByRole('button', { name: '▶ Play' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play Secrets' }));

    expect(screen.getByRole('dialog', { name: 'Playing Secrets' })).toBeInTheDocument();
  });

  it('keeps the detail open when the player closes (Escape) on its own', async () => {
    const { user, onClose } = renderDetail(heat);
    await user.click(screen.getByRole('button', { name: '▶ Play' }));

    (screen.getByRole('dialog', { name: 'Playing Heat' }) as HTMLDialogElement).close();

    expect(screen.queryByRole('dialog', { name: 'Playing Heat' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes the detail itself', async () => {
    const { user, onClose } = renderDetail(heat);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

function saved(mediaId: string, positionSec: number, finished = false): WatchProgress {
  return { mediaId, positionSec, durationSec: 6000, finished, updatedAt: '' };
}

describe('DetailDialog resume', () => {
  it('offers to resume at the saved position', async () => {
    const { user, api } = renderDetail(heat, always, vi.fn(), [saved('heat', 754)]);

    await user.click(await screen.findByRole('button', { name: '▶ Resume from 12:34' }));

    expect(api.start).toHaveBeenCalledWith('heat', true, 754);
  });

  it('starts over from 0 on request', async () => {
    const { user, api } = renderDetail(heat, always, vi.fn(), [saved('heat', 754)]);

    await user.click(await screen.findByRole('button', { name: 'Start over' }));

    expect(api.start).toHaveBeenCalledWith('heat', true, 0);
  });

  it('offers a plain Play for a finished title', async () => {
    const { user, api } = renderDetail(heat, always, vi.fn(), [saved('heat', 5900, true)]);

    await user.click(await screen.findByRole('button', { name: '▶ Play' }));

    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(api.start).toHaveBeenCalledWith('heat', true, 0);
  });

  it('resumes an episode at its own position', async () => {
    const series = media({ id: 'show', title: 'Show', kind: 'series' });
    const pilot = media({
      id: 'e1',
      title: 'Pilot',
      kind: 'episode',
      season: 1,
      episode: 1,
      relativePath: 'Show/S01E01.mp4',
      streams: H264_AAC,
    });
    const { user, api } = renderDetail(
      series,
      always,
      vi.fn(),
      [saved('e1', 65)],
      [{ season: 1, episodes: [pilot] }],
    );

    await user.click(await screen.findByRole('button', { name: 'Resume Pilot from 1:05' }));

    expect(api.start).toHaveBeenCalledWith('e1', true, 65);
  });
});
