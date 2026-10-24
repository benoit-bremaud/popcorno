import { desc, eq } from 'drizzle-orm';
import { isFinished } from '@popcorno/shared';
import type { WatchProgress } from '@popcorno/shared';
import type { AppDatabase } from '../db/index.js';
import { DEFAULT_PROFILE, media, watchProgress } from '../db/schema.js';

/** Reads and writes `watch_progress` (spec resume-playback §2.1). */
export class ProgressRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Upserts the position of a playable media, clamped to its duration when known. False
   * for an unknown media or a `series` row (it has no file to play).
   */
  save(mediaId: string, positionSec: number, now: Date = new Date()): boolean {
    const row = this.db
      .select({ kind: media.kind, durationSec: media.durationSec })
      .from(media)
      .where(eq(media.id, mediaId))
      .get();
    if (row === undefined || row.kind === 'series') return false;
    const position =
      row.durationSec === null ? positionSec : Math.min(positionSec, row.durationSec);
    const updatedAt = now.toISOString();
    this.db
      .insert(watchProgress)
      .values({ profileId: DEFAULT_PROFILE, mediaId, positionSec: position, updatedAt })
      .onConflictDoUpdate({
        target: [watchProgress.profileId, watchProgress.mediaId],
        set: { positionSec: position, updatedAt },
      })
      .run();
    return true;
  }

  /** Every position of the default profile, newest first. */
  list(): WatchProgress[] {
    return this.db
      .select({
        mediaId: watchProgress.mediaId,
        positionSec: watchProgress.positionSec,
        durationSec: media.durationSec,
        updatedAt: watchProgress.updatedAt,
      })
      .from(watchProgress)
      .innerJoin(media, eq(media.id, watchProgress.mediaId))
      .where(eq(watchProgress.profileId, DEFAULT_PROFILE))
      .orderBy(desc(watchProgress.updatedAt))
      .all()
      .map((row) => ({ ...row, finished: isFinished(row) }));
  }
}
