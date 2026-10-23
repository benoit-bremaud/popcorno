import { useEffect, useRef, useState } from 'react';
import { decidePlayback } from '@popcorno/shared';
import type { CanPlay, Media } from '@popcorno/shared';
import { artworkUrl } from '../api.js';
import { browserCanPlay } from '../playback/can-play.js';
import { PlayerDialog } from '../playback/PlayerDialog.js';
import type { PlaybackApi } from '../playback/PlayerDialog.js';
import type { Season } from './catalog.js';

type Props = {
  readonly item: Media;
  readonly seasons: readonly Season[];
  readonly onClose: () => void;
  /** The browser's decoder check; injected by tests (jsdom decodes nothing). */
  readonly canPlay?: CanPlay;
  /** Playback server calls; injected by tests. */
  readonly api?: PlaybackApi;
};

function facts(item: Media): string[] {
  const runtime = item.metadata?.runtimeMin ?? null;
  const rating = item.metadata?.voteAverage ?? null;
  return [
    item.year === null ? null : String(item.year),
    runtime === null ? null : `${runtime} min`,
    rating === null ? null : `★ ${rating.toFixed(1)}`,
  ].filter((fact): fact is string => fact !== null);
}

/** UC4: a modal `<dialog>` over the catalog; Escape or the close button close it. */
export function DetailDialog({
  item,
  seasons,
  onClose,
  canPlay = browserCanPlay,
  api,
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState<Media | null>(null);
  // The Play button that opened the player gets the focus back when it closes (spec step 6).
  const trigger = useRef<HTMLButtonElement | null>(null);

  function play(media: Media, button: HTMLButtonElement): void {
    trigger.current = button;
    setPlaying(media);
  }

  function stop(): void {
    setPlaying(null);
    trigger.current?.focus();
  }

  // Every file with a video stream plays: directly, or through HLS (spec hls-transcode R1).
  const playable = (media: Media): boolean =>
    media.kind !== 'series' && media.streams.some((stream) => stream.type === 'video');

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const metadata = item.metadata;
  const backdrop = metadata?.backdropPath ?? null;
  const titleId = `detail-${item.id}`;

  return (
    <dialog
      ref={ref}
      className="detail"
      aria-labelledby={titleId}
      // Every close path (button, Escape) ends in the native `close` event, fired once the
      // modal is no longer inert, so the caller can move the focus back. React propagates
      // `close` up its tree, so the nested player's own close must not end the detail too.
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="detail__panel">
        {backdrop !== null && (
          <img className="detail__backdrop" src={artworkUrl(backdrop)} alt="" />
        )}
        <button
          type="button"
          className="detail__close"
          aria-label="Close"
          onClick={() => ref.current?.close()}
        >
          ✕
        </button>
        <div className="detail__body">
          <h2 className="detail__title" id={titleId}>
            {item.title}
          </h2>
          <p className="detail__facts">{facts(item).join(' · ')}</p>
          {playable(item) && (
            <button
              type="button"
              className="button detail__play"
              onClick={(event) => play(item, event.currentTarget)}
            >
              ▶ Play
            </button>
          )}
          {metadata !== null && metadata.genres.length > 0 && (
            <ul className="detail__genres" aria-label="Genres">
              {metadata.genres.map((genre) => (
                <li key={genre.id}>{genre.name}</li>
              ))}
            </ul>
          )}
          <p className="detail__overview">{metadata?.overview ?? 'No synopsis yet.'}</p>
          {metadata !== null && metadata.cast.length > 0 && (
            <p className="detail__cast">
              <span className="muted">Cast: </span>
              {metadata.cast.map((member) => member.name).join(', ')}
            </p>
          )}
          {seasons.map((season) => (
            <section key={season.season ?? 'none'} className="detail__season">
              <h3>{season.season === null ? 'Episodes' : `Season ${season.season}`}</h3>
              <ol>
                {season.episodes.map((episode) => (
                  <li key={episode.id}>
                    <span className="muted">{episode.episode ?? '–'}</span> {episode.title}
                    {playable(episode) && (
                      <button
                        type="button"
                        className="chip chip--small detail__episode-play"
                        aria-label={`Play ${episode.title}`}
                        onClick={(event) => play(episode, event.currentTarget)}
                      >
                        ▶
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
      {playing !== null && (
        <PlayerDialog
          item={playing}
          directPlay={decidePlayback(playing, canPlay).mode === 'direct'}
          onClose={stop}
          api={api}
        />
      )}
    </dialog>
  );
}
