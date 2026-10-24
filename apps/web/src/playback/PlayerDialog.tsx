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
 * heartbeats while open, and ends the session on `close` (Close or Escape); a tab closed
 * without it is left to the server's idle watchdog.
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
  /** Playback is over: the message shows and the transcode slot is freed (spec 4a). */
  const fail = (): void => {
    setStatus({ kind: 'error', message: FAILED });
    void endSession();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  // One start per mounted player: StrictMode re-runs effects, and a second POST would race
  // the first for the transcode slot. The session ends on `close`, not in a cleanup.
  const started = useRef<ReturnType<PlaybackApi['start']> | null>(null);

  useEffect(() => {
    started.current ??= api.start(item.id, directPlay);
    let active = true;
    const run = async (): Promise<void> => {
      const result = await started.current;
      if (!active || result === null) return;
      if (result === 'busy') setStatus({ kind: 'error', message: BUSY });
      else if (result === 'failed') setStatus({ kind: 'error', message: FAILED });
      else setStatus({ kind: 'ready', start: result });
    };
    void run();
    return () => {
      active = false;
    };
    // Mount only: a new title remounts the player (`key` in DetailDialog).
  }, []);

  /** Close button, Escape: the HLS session ends (even if it is still starting). */
  async function endSession(): Promise<void> {
    const result = await started.current;
    if (result !== null && typeof result === 'object' && result.mode === 'hls') {
      await api.stop(result.sessionId);
    }
  }

  const start = status.kind === 'ready' ? status.start : null;

  useEffect(() => {
    const element = video.current;
    if (start?.mode !== 'hls' || element === null) return;
    let detach: (() => void) | null = null;
    let active = true;
    const run = async (): Promise<void> => {
      let cleanup: () => void;
      try {
        cleanup = await attach(element, start.url, fail);
      } catch {
        // The hls.js chunk could not be loaded.
        if (active) fail();
        return;
      }
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
    <dialog
      ref={ref}
      className="player"
      aria-label={`Playing ${item.title}`}
      onClose={() => {
        void endSession();
        onClose();
      }}
    >
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
        <output className="player__status muted">Preparing playback…</output>
      )}
      {start !== null && (
        <video
          ref={video}
          className="player__video"
          src={start.mode === 'direct' ? start.url : undefined}
          controls
          autoPlay
          // In HLS mode hls.js reports fatal errors itself; a detach (re-render, close) also
          // fires `error` on the element and must not count as a failure.
          onError={start.mode === 'direct' ? fail : undefined}
        />
      )}
    </dialog>
  );
}
