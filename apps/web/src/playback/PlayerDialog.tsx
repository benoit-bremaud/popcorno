import { useEffect, useRef, useState } from 'react';
import { isFinished } from '@popcorno/shared';
import type { Media, PlaybackStart } from '@popcorno/shared';
import { saveProgress, sendHeartbeat, startPlayback, stopPlayback } from '../api.js';
import { attachHls } from './hls-source.js';

/** The server calls the player needs; injected by tests. */
export interface PlaybackApi {
  readonly start: typeof startPlayback;
  readonly heartbeat: typeof sendHeartbeat;
  readonly stop: typeof stopPlayback;
  readonly save: typeof saveProgress;
}

const DEFAULT_API: PlaybackApi = {
  start: startPlayback,
  heartbeat: sendHeartbeat,
  stop: stopPlayback,
  save: saveProgress,
};

/** A paused player must keep its session under the 60 s idle limit (ADR-0006 §4). */
const HEARTBEAT_MS = 20_000;
/** At most 10 s of viewing lost if the tab dies (ADR-0007 §3). */
const SAVE_MS = 10_000;

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
  /** Media time to resume at (UC6); 0 starts over. */
  readonly startSec?: number;
  /** The episode after this one (UC7), offered once this one is finished or ended. */
  readonly next?: Media | null;
  /** Plays `next`; this player's session is already ended and its position saved. */
  readonly onNext?: (next: Media) => void;
  readonly onClose: () => void;
  readonly api?: PlaybackApi;
  readonly attach?: typeof attachHls;
};

/**
 * UC5 / UC6 / UC7: a full-viewport modal `<dialog>` on the native `<video controls>`. It asks the
 * server for a playback session, then plays the file directly or the HLS playlist, sends
 * heartbeats while open, and ends the session on `close` (Close or Escape); a tab closed
 * without it is left to the server's idle watchdog. It resumes at `startSec`, saves the
 * position every 10 s while playing, on pause and on close, and offers the next episode.
 */
export function PlayerDialog({
  item,
  directPlay,
  startSec = 0,
  next = null,
  onNext,
  onClose,
  api = DEFAULT_API,
  attach = attachHls,
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const [offerNext, setOfferNext] = useState(false);
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
    started.current ??= api.start(item.id, directPlay, startSec);
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

  /** Media time of the picture on screen: the HLS timeline starts at `offsetSec`. */
  function position(): number | null {
    const element = video.current;
    if (start === null || element === null) return null;
    return start.offsetSec + Math.floor(element.currentTime);
  }

  function save(): void {
    const at = position();
    if (at !== null) void api.save(item.id, at);
  }

  /** Direct play seeks in the file; an HLS session already starts at the offset. */
  function seekToStart(): void {
    const element = video.current;
    const seek = startSec - (start?.offsetSec ?? 0);
    if (element !== null && seek > 0) element.currentTime = seek;
  }

  /** UC7 trigger: 90 % of the duration (the file's, else the element's) or the end. */
  function checkFinished(): void {
    const at = position();
    const element = video.current;
    if (next === null || offerNext || at === null || element === null) return;
    const elementDuration = Number.isFinite(element.duration)
      ? (start?.offsetSec ?? 0) + Math.floor(element.duration)
      : null;
    const durationSec = item.durationSec ?? elementDuration;
    if (isFinished({ positionSec: at, durationSec })) setOfferNext(true);
  }

  async function playNext(episode: Media): Promise<void> {
    save();
    await endSession();
    onNext?.(episode);
  }

  useEffect(() => {
    if (start === null) return;
    const timer = setInterval(() => {
      if (video.current?.paused === false) save();
    }, SAVE_MS);
    return () => clearInterval(timer);
    // `save` reads refs and `start` only: the interval is reset when playback (re)starts.
  }, [start]);

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
        save();
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
          onLoadedMetadata={seekToStart}
          onPause={save}
          onTimeUpdate={checkFinished}
          onEnded={() => {
            if (next !== null) setOfferNext(true);
          }}
          // In HLS mode hls.js reports fatal errors itself; a detach (re-render, close) also
          // fires `error` on the element and must not count as a failure.
          onError={start.mode === 'direct' ? fail : undefined}
        />
      )}
      {offerNext && next !== null && (
        <button type="button" className="button player__next" onClick={() => void playNext(next)}>
          Next episode: {next.title} ▶
        </button>
      )}
    </dialog>
  );
}
