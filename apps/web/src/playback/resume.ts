import type { WatchProgress } from '@popcorno/shared';

/** A few seconds of play are not worth a resume offer (spec resume-playback §2.4). */
export const MIN_RESUME_SEC = 10;

/** Where to resume a title, or 0 when it is unwatched, barely started or finished. */
export function resumeAt(progress: WatchProgress | undefined): number {
  if (progress === undefined || progress.finished) return 0;
  return progress.positionSec >= MIN_RESUME_SEC ? progress.positionSec : 0;
}

/** `h:mm:ss` from one hour, `m:ss` below. */
export function formatPosition(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = String(totalSec % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
