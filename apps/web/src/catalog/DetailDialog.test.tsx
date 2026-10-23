import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CanPlay, Media, StreamInfo } from '@popcorno/shared';
import { media } from '../test-fixtures.js';
import { DetailDialog } from './DetailDialog.js';

const H264_AAC: StreamInfo[] = [
  { type: 'video', codec: 'h264', width: 1920, height: 1080, language: null },
  { type: 'audio', codec: 'aac', width: null, height: null, language: 'eng' },
];

const heat = media({ id: 'heat', title: 'Heat', relativePath: 'Heat.mp4', streams: H264_AAC });
const always: CanPlay = () => 'probably';

function renderDetail(item: Media, canPlay: CanPlay = always, onClose = vi.fn()) {
  return {
    user: userEvent.setup(),
    onClose,
    ...render(<DetailDialog item={item} seasons={[]} onClose={onClose} canPlay={canPlay} />),
  };
}

describe('DetailDialog playback', () => {
  it('plays a direct-playable film in a native video and returns focus to Play', async () => {
    const { user, onClose } = renderDetail(heat);

    const play = screen.getByRole('button', { name: '▶ Play' });
    await user.click(play);

    const player = screen.getByRole('dialog', { name: 'Playing Heat' });
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
    const video = player.querySelector('video');
    if (video === null) throw new Error('no video');
    fireEvent.error(video);

    expect(within(player).getByRole('alert')).toHaveTextContent('This file could not be played.');
  });

  it('offers no Play button when the browser cannot decode the file', () => {
    renderDetail(heat, () => '');

    expect(screen.queryByRole('button', { name: '▶ Play' })).not.toBeInTheDocument();
    expect(screen.getByText('Not playable in this browser yet.')).toBeInTheDocument();
  });

  it('offers no Play button for a container left to HLS (#8)', () => {
    renderDetail(media({ id: 'mkv', title: 'Mkv', streams: H264_AAC }));

    expect(screen.getByText('Not playable in this browser yet.')).toBeInTheDocument();
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
      />,
    );

    expect(screen.queryByRole('button', { name: '▶ Play' })).not.toBeInTheDocument();
    expect(screen.queryByText('Not playable in this browser yet.')).not.toBeInTheDocument();
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

  it('offers no Play button on an episode the browser cannot decode', () => {
    const pilot = media({
      id: 'pilot',
      title: 'Secrets',
      kind: 'episode',
      relativePath: 'Dark/S01E01.mp4',
      streams: H264_AAC,
      season: 1,
      episode: 1,
    });
    render(
      <DetailDialog
        item={media({ id: 'dark', title: 'Dark', kind: 'series', relativePath: null })}
        seasons={[{ season: 1, episodes: [pilot] }]}
        onClose={vi.fn()}
        canPlay={() => ''}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Play Secrets' })).not.toBeInTheDocument();
  });

  it('still closes the detail itself', async () => {
    const { user, onClose } = renderDetail(heat);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
