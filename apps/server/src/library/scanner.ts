import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { Library, ScanReport, SkipReason, SkippedFile } from '@popcorno/shared';
import type { Prober } from './ffprobe.js';
import { isExtra, parseMediaName } from './name-parser.js';
import { isAtOrUnderRoot, resolveUnderRoot } from './path-guard.js';
import type { LibraryRepository } from './repository.js';

/** What the walk produces; the scan route adds the `metadata` section (UC1's «include» of UC2). */
export type ScanOutcome = Omit<ScanReport, 'metadata'>;

/** Video containers the walk keeps (spec § Technology and data variations); lower-case, with the dot. */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mkv',
  '.mp4',
  '.m4v',
  '.webm',
  '.avi',
  '.mov',
]);

/** Thrown when the library root cannot be walked at all or escapes the media root (spec 2b). */
export class RootUnreadableError extends Error {
  constructor(rootPath: string, reason: string) {
    super(`Library root ${rootPath} ${reason}`);
    this.name = 'RootUnreadableError';
  }
}

/** A file found under the root: its real path (the guard's result) and fingerprint. */
interface LocatedFile {
  readonly realPath: string;
  readonly fileSize: number;
  readonly fileMtimeMs: number;
}

type StoreOutcome = 'added' | 'updated' | 'unchanged' | 'probe_failed';

/** Walks the library root and persists what it finds (sequence diagram 02-scan-library). */
export class LibraryScanner {
  /** `mediaRoot`: the folder every library root must resolve under, symlinks followed. */
  constructor(
    private readonly repository: LibraryRepository,
    private readonly probe: Prober,
    private readonly mediaRoot: string,
  ) {}

  /**
   * Runs UC1 on one library and returns its report. Not guarded against a concurrent run:
   * the scan route holds the `LibraryLock` (spec *a), so the scanner stays a pure walk.
   * @throws {RootUnreadableError} when the root is missing, not a directory, or a link
   *   whose target escapes the media root (spec 2b).
   */
  async scan(library: Library): Promise<ScanOutcome> {
    const root = await realRoot(library.rootPath, this.mediaRoot);
    const { files, unreadableDirs } = await walk(root);
    const skipped: SkippedFile[] = unreadableDirs.map((dir) => ({
      path: toPosix(relative(root, dir)),
      reason: 'unreadable',
    }));
    const seen = new Set<string>();
    const counts = { added: 0, updated: 0 };
    let unreadableFiles = 0;

    await forEachSeries(files, async (filePath) => {
      const relativePath = toPosix(relative(root, filePath));
      const located = await locate(root, filePath);
      if (typeof located === 'string') {
        if (located === 'unreadable') unreadableFiles += 1;
        skipped.push({ path: relativePath, reason: located });
        return;
      }
      if (isExtra(relativePath)) {
        skipped.push({ path: relativePath, reason: 'extra' });
        return;
      }
      // One row per real file: a second link to it (sorted order) is reported, not stored.
      if (seen.has(located.realPath)) {
        skipped.push({ path: relativePath, reason: 'duplicate' });
        return;
      }
      // Seen as soon as it belongs to the library: a failed probe must not delete its row.
      seen.add(located.realPath);
      const outcome = await this.store(library, relativePath, located);
      if (outcome === 'probe_failed') skipped.push({ path: relativePath, reason: outcome });
      else if (outcome !== 'unchanged') counts[outcome] += 1;
    });
    // Pruning is only safe when the walk saw the whole tree, every file could be
    // fingerprinted and the root is not an empty mount point: otherwise present files
    // would be deleted (and their future metadata).
    const canPrune = unreadableDirs.length === 0 && unreadableFiles === 0 && files.length > 0;
    const removed = canPrune ? this.repository.deleteMissing(library.id, seen) : 0;
    return { ...counts, removed, skipped };
  }

  private async store(
    library: Library,
    relativePath: string,
    file: LocatedFile,
  ): Promise<StoreOutcome> {
    const stored = this.repository.findStoredFile(library.id, file.realPath);
    // The relative path is part of the fingerprint: a renamed link to the same target
    // must refresh the path-derived fields (title, year, episode…).
    if (
      stored?.fileSize === file.fileSize &&
      stored.fileMtimeMs === file.fileMtimeMs &&
      stored.relativePath === relativePath
    ) {
      return 'unchanged';
    }
    let probed: Awaited<ReturnType<Prober>>;
    try {
      probed = await this.probe(file.realPath);
    } catch {
      return 'probe_failed';
    }
    const parsed = parseMediaName(relativePath, library.kind);
    const seriesId =
      parsed.kind === 'episode'
        ? this.repository.findOrCreateSeries(
            library.id,
            parsed.title,
            parsed.year,
            parsed.providerIds,
          )
        : null;
    this.repository.upsertMedia(
      library.id,
      {
        ...parsed,
        filePath: file.realPath,
        relativePath,
        fileSize: file.fileSize,
        fileMtimeMs: file.fileMtimeMs,
        durationSec: probed.durationSec,
        seriesId,
      },
      probed.streams,
    );
    return stored ? 'updated' : 'added';
  }
}

/**
 * The real path of the library root, checked against the real media root: a link placed
 * under `MEDIA_ROOT` must not pull an external tree into the library.
 */
async function realRoot(rootPath: string, mediaRoot: string): Promise<string> {
  const info = await stat(rootPath).catch(() => null);
  if (!info?.isDirectory()) throw new RootUnreadableError(rootPath, 'is not a readable directory');
  const [real, realMediaRoot] = await Promise.all([realpath(rootPath), realpath(mediaRoot)]);
  if (!isAtOrUnderRoot(realMediaRoot, real)) {
    throw new RootUnreadableError(rootPath, 'resolves outside MEDIA_ROOT');
  }
  return real;
}

/** Resolves and fingerprints one file; a dangling link is `unreadable`, an escape `outside_root`. */
async function locate(root: string, filePath: string): Promise<LocatedFile | SkipReason> {
  let realPath: string;
  let fileSize: number;
  let fileMtimeMs: number;
  try {
    realPath = await realpath(filePath);
    const info = await stat(realPath);
    fileSize = info.size;
    fileMtimeMs = Math.round(info.mtimeMs);
  } catch {
    return 'unreadable';
  }
  if (resolveUnderRoot(root, realPath) === null) return 'outside_root';
  return { realPath, fileSize, fileMtimeMs };
}

interface WalkResult {
  readonly files: readonly string[];
  readonly unreadableDirs: readonly string[];
}

const EMPTY_WALK: WalkResult = { files: [], unreadableDirs: [] };

/**
 * Recursive walk, directories read concurrently, result in sorted order; an unreadable
 * directory is reported and its siblings continue (spec 3a).
 */
async function walk(dir: string): Promise<WalkResult> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files: [], unreadableDirs: [dir] };
  }
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const children = await Promise.all(
    sorted.map((entry): Promise<WalkResult> => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      const supported = SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase());
      return Promise.resolve(supported ? { files: [full], unreadableDirs: [] } : EMPTY_WALK);
    }),
  );
  return {
    files: children.flatMap((child) => child.files),
    unreadableDirs: children.flatMap((child) => child.unreadableDirs),
  };
}

/** Runs `fn` on the items one after the other: one ffprobe process at a time, sorted order. */
function forEachSeries<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  return items.reduce((previous, item) => previous.then(() => fn(item)), Promise.resolve());
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}
