import { useEffect, useRef, useState } from 'react';
import type { Media } from '@popcorno/shared';
import { mediaFileUrl } from '../api.js';

type Props = {
  readonly item: Media;
  readonly onClose: () => void;
};

/**
 * UC5 direct play: a full-viewport modal `<dialog>` on the native `<video controls>`
 * (seek, pause, full screen come with it). Escape or Close end it; the media element
 * stops with the dialog since it unmounts.
 */
export function PlayerDialog({ item, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="player" aria-label={`Playing ${item.title}`} onClose={onClose}>
      <button
        type="button"
        className="detail__close player__close"
        aria-label="Close player"
        onClick={() => ref.current?.close()}
      >
        ✕
      </button>
      {failed ? (
        <p className="player__error" role="alert">
          This file could not be played.
        </p>
      ) : (
        <video
          className="player__video"
          src={mediaFileUrl(item.id)}
          controls
          autoPlay
          onError={() => setFailed(true)}
        >
          {/* Subtitle tracks are not served yet; the empty track keeps the captions menu. */}
          <track kind="captions" />
        </video>
      )}
    </dialog>
  );
}
