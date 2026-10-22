import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { Library, ScanReport, SkipReason, SkippedFile } from '@popcorno/shared';
import type { Prober } from './ffprobe.js';
import { isExtra, parseMediaName } from './name-parser.js';
import { resolveUnderRoot } from './path-guard.js';
import type { LibraryRepository } from './repository.js';

/** Video containers the walk keeps (spec § Technology and data variations); lower-case, with the dot. */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mkv',
  '.mp4',
  '.m4v',
  '.webm',
  '.avi',
  '.mov',
]);

/** Thrown when the library root cannot be walked at all (spec extension 2b). */
export class RootUnreadableError extends Error {
  constructor(rootPath: string) {
    super(`Library root is not a readable directory: ${rootPath}`);
    this.name = 'RootUnreadableError';
  }
}

/** Thrown when a scan of the same library is already in flight (spec extension *a). */
export class ScanRunningError extends Error {
  constructor(libraryId: string) {
    super(`A scan of library ${libraryId} is already running`);
    this.name = 'ScanRunningError';
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
  private readonly running = new Set<string>();

  constructor(
    private readonly repository: LibraryRepository,
    private readonly probe: Prober,
  ) {}

  /**
   * Runs UC1 on one library and returns its report.
   * @throws {RootUnreadableError} when the root is missing or not a directory (spec 2b).
   * @throws {ScanRunningError} when a scan of the same library is in flight (spec *a).
   */
  async scan(library: Library): Promise<ScanReport> {
    if (this.running.has(library.id)) throw new ScanRunningError(library.id);
    this.running.add(library.id);
    try {
      return await this.run(library);
    } finally {
      this.running.delete(library.id);
    }
  }

  private async run(library: Library): Promise<ScanReport> {
    const root = await realRoot(library.rootPath);
    const { files, unreadableDirs } = await walk(root);
    const skipped: SkippedFile[] = unreadableDirs.map((dir) => ({
      path: toPosix(relative(root, dir)),
      reason: 'unreadable',
    }));
    const seen = new Set<string>();
    const counts = { added: 0, updated: 0 };

    await forEachSeries(files, async (filePath) => {
      const relativePath = toPosix(relative(root, filePath));
      const located = await locate(root, filePath);
      if (typeof located === 'string') {
        skipped.push({ path: relativePath, reason: located });
        return;
      }
      if (isExtra(relativePath)) {
        skipped.push({ path: relativePath, reason: 'extra' });
        return;
      }
      // Seen as soon as it belongs to the library: a failed probe must not delete its row.
      seen.add(located.realPath);
      const outcome = await this.store(library, relativePath, located);
      if (outcome === 'probe_failed') skipped.push({ path: relativePath, reason: outcome });
      else if (outcome !== 'unchanged') counts[outcome] += 1;
    });
    // Pruning is only safe when the walk saw the whole tree and the root is not an empty
    // mount point: otherwise present files would be deleted (and their future metadata).
    const canPrune = unreadableDirs.length === 0 && files.length > 0;
    const removed = canPrune ? this.repository.deleteMissing(library.id, seen) : 0;
    return { ...counts, removed, skipped };
  }

  private async store(
    library: Library,
    relativePath: string,
    file: LocatedFile,
  ): Promise<StoreOutcome> {
    const stored = this.repository.findStoredFile(library.id, file.realPath);
    if (stored?.fileSize === file.fileSize && stored.fileMtimeMs === file.fileMtimeMs) {
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

async function realRoot(rootPath: string): Promise<string> {
  const info = await stat(rootPath).catch(() => null);
  if (!info?.isDirectory()) throw new RootUnreadableError(rootPath);
  return realpath(rootPath);
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
