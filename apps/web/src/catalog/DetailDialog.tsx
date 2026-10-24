import { useEffect, useRef, useState } from 'react';
import { decidePlayback } from '@popcorntv/shared';
import type { CanPlay, Media, WatchProgress } from '@popcorntv/shared';
import { artworkUrl, loadProgress } from '../api.js';
import { browserCanPlay } from '../playback/can-play.js';
import { PlayerDialog } from '../playback/PlayerDialog.js';
import type { PlaybackApi } from '../playback/PlayerDialog.js';
import { formatPosition, resumeAt } from '../playback/resume.js';
import { nextEpisode } from './catalog.js';
import type { Season } from './catalog.js';

type Props = {
  readonly item: Media;
  readonly seasons: readonly Season[];
  readonly onClose: () => void;
  /** The browser's decoder check; injected by tests (jsdom decodes nothing). */
  readonly canPlay?: CanPlay;
  /** Playback server calls; injected by tests. */
  readonly api?: PlaybackApi;
  /** `GET /progress`; injected by tests. */
  readonly progress?: typeof loadProgress;
};

/** What the player plays and where it starts. */
type Playing = { readonly media: Media; readonly startSec: number };

function facts(item: Media): string[] {
  const runtime = item.metadata?.runtimeMin ?? null;
  const rating = item.metadata?.voteAverage ?? null;
  return [
    item.year === null ? null : String(item.year),
    runtime === null ? null : `${runtime} min`,
    rating === null ? null : `★ ${rating.toFixed(1)}`,
  ].filter((fact): fact is string => fact !== null);
}

/** An episode's accessible name: untitled episodes all carry the series title. */
function episodeName(episode: Media): string {
  return episode.episode === null ? episode.title : `${episode.title}, episode ${episode.episode}`;
}

/** UC4: a modal `<dialog>` over the catalog; Escape or the close button close it. */
export function DetailDialog({
  item,
  seasons,
  onClose,
  canPlay = browserCanPlay,
  api,
  progress = loadProgress,
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  /** Null until the first load: Play waits for it, so a resume point is never skipped. */
  const [saved, setSaved] = useState<ReadonlyMap<string, WatchProgress> | null>(null);
  /** Only the latest request may set `saved` (a slow first load must not win). */
  const request = useRef(0);

  async function refreshProgress(): Promise<void> {
    const id = ++request.current;
    const rows = await progress();
    if (id === request.current) setSaved(new Map(rows.map((row) => [row.mediaId, row])));
  }

  useEffect(() => {
    void refreshProgress();
    // Once per opened title; the player's close refreshes it again.
  }, []);

  const resume = (media: Media): number => resumeAt(saved?.get(media.id));
  // The Play button that opened the player gets the focus back when it closes (spec step 6).
  const trigger = useRef<HTMLButtonElement | null>(null);

  function play(media: Media, startSec: number, button: HTMLButtonElement): void {
    trigger.current = button;
    setPlaying({ media, startSec });
  }

  /** Reloads the offer once the player's last save has landed (spec step 7). */
  async function stop(lastSave: Promise<void>): Promise<void> {
    setPlaying(null);
    trigger.current?.focus();
    await lastSave;
    await refreshProgress();
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
          {playable(item) && saved !== null && (
            <div className="detail__actions">
              {resume(item) > 0 ? (
                <>
                  <button
                    type="button"
                    className="button"
                    onClick={(event) => play(item, resume(item), event.currentTarget)}
                  >
                    ▶ Resume from {formatPosition(resume(item))}
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={(event) => play(item, 0, event.currentTarget)}
                  >
                    Start over
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={(event) => play(item, 0, event.currentTarget)}
                >
                  ▶ Play
                </button>
              )}
            </div>
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
                    {playable(episode) && saved !== null && (
                      <button
                        type="button"
                        className="chip chip--small detail__episode-play"
                        aria-label={
                          resume(episode) > 0
                            ? `Resume ${episodeName(episode)} from ${formatPosition(resume(episode))}`
                            : `Play ${episodeName(episode)}`
                        }
                        onClick={(event) => play(episode, resume(episode), event.currentTarget)}
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
          key={playing.media.id}
          item={playing.media}
          directPlay={decidePlayback(playing.media, canPlay).mode === 'direct'}
          startSec={playing.startSec}
          next={nextEpisode(seasons, playing.media)}
          onNext={(episode) => setPlaying({ media: episode, startSec: resume(episode) })}
          onClose={(lastSave) => void stop(lastSave)}
          api={api}
        />
      )}
    </dialog>
  );
}
