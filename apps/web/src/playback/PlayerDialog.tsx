import { useEffect, useRef, useState } from 'react';
import type { Media, PlaybackStart } from '@popcorno/shared';
import { sendHeartbeat, startPlayback, stopPlayback } from '../api.js';
import { attachHls } from './hls-source.js';

/** The server calls the player needs; injected by tests. */
export interface PlaybackApi {
  readonly start: typeof startPlayback;
  readonly heartbeat: typeof sendHeartbeat;
  readonly stop: typeof stopPlayback;
}

const DEFAULT_API: PlaybackApi = {
  start: startPlayback,
  heartbeat: sendHeartbeat,
  stop: stopPlayback,
};

/** A paused player must keep its session under the 60 s idle limit (ADR-0006 §4). */
const HEARTBEAT_MS = 20_000;

const FAILED = 'This file could not be played.';
const BUSY = 'Another title is being transcoded. Try again later.';

type Status =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly start: PlaybackStart }
  | { readonly kind: 'error'; readonly message: string };

type Props = {
  readonly item: Media;
  /** The browser's own direct-play answer; the server confirms it (spec hls-transcode). */
  readonly directPlay: boolean;
  readonly onClose: () => void;
  readonly api?: PlaybackApi;
  readonly attach?: typeof attachHls;
};

/**
 * UC5: a full-viewport modal `<dialog>` on the native `<video controls>`. It asks the
 * server for a playback session, then plays the file directly or the HLS playlist, sends
 * heartbeats while open, and ends the session when it unmounts (Close or Escape).
 */
export function PlayerDialog({
  item,
  directPlay,
  onClose,
  api = DEFAULT_API,
  attach = attachHls,
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const fail = (): void => setStatus({ kind: 'error', message: FAILED });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    let sessionId: string | null = null;
    const run = async (): Promise<void> => {
      const result = await api.start(item.id, directPlay);
      if (result !== 'busy' && result !== 'failed' && result.mode === 'hls') {
        sessionId = result.sessionId;
        // Closed while the transcode was starting: end it at once.
        if (!active) await api.stop(result.sessionId);
      }
      if (!active) return;
      if (result === 'busy') setStatus({ kind: 'error', message: BUSY });
      else if (result === 'failed') setStatus({ kind: 'error', message: FAILED });
      else setStatus({ kind: 'ready', start: result });
    };
    void run();
    return () => {
      active = false;
      if (sessionId !== null) void api.stop(sessionId);
    };
  }, [api, item.id, directPlay]);

  const start = status.kind === 'ready' ? status.start : null;

  useEffect(() => {
    const element = video.current;
    if (start?.mode !== 'hls' || element === null) return;
    let detach: (() => void) | null = null;
    let active = true;
    const run = async (): Promise<void> => {
      const cleanup = await attach(element, start.url, fail);
      if (active) detach = cleanup;
      else cleanup();
    };
    void run();
    const timer = setInterval(() => void api.heartbeat(start.sessionId), HEARTBEAT_MS);
    return () => {
      active = false;
      clearInterval(timer);
      detach?.();
    };
    // `fail` only sets state, so it is left out: a new closure must not re-attach hls.js.
  }, [api, attach, start]);

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
      {status.kind === 'error' && (
        <p className="player__error" role="alert">
          {status.message}
        </p>
      )}
      {status.kind === 'starting' && (
        <p className="player__status muted" role="status">
          Preparing playback…
        </p>
      )}
      {start !== null && (
        <video
          ref={video}
          className="player__video"
          src={start.mode === 'direct' ? start.url : undefined}
          controls
          autoPlay
          onError={fail}
        />
      )}
    </dialog>
  );
}
