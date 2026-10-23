import { useEffect, useRef } from 'react';
import type { Media } from '@popcorno/shared';
import { artworkUrl } from '../api.js';
import type { Season } from './catalog.js';

type Props = {
  readonly item: Media;
  readonly seasons: readonly Season[];
  readonly onClose: () => void;
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
export function DetailDialog({ item, seasons, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

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
      // modal is no longer inert, so the caller can move the focus back.
      onClose={onClose}
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
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
