import { readdir, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Library, ScanReport, SkippedFile } from '@popcorno/shared';
import type { Prober } from './ffprobe.js';
import { isExtra, parseMediaName } from './name-parser.js';
import { resolveUnderRoot } from './path-guard.js';
import type { LibraryRepository, MediaInput } from './repository.js';

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

/** Walks the library root and persists what it finds (sequence diagram 02-scan-library). */
export class LibraryScanner {
  private readonly running = new Set<string>();

  constructor(
    private readonly repository: LibraryRepository,
    private readonly probe: Prober,
  ) {}

  isRunning(libraryId: string): boolean {
    return this.running.has(libraryId);
  }

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
    const root = await this.realRoot(library.rootPath);
    const skipped: SkippedFile[] = [];
    const seen: string[] = [];
    let added = 0;
    let updated = 0;

    for (const filePath of await walk(root, skipped)) {
      const outcome = await this.processFile(library, root, filePath, skipped);
      if (outcome === 'skipped') continue;
      seen.push(filePath);
      if (outcome === 'added') added += 1;
      if (outcome === 'updated') updated += 1;
    }
    const removed = this.repository.deleteMissing(library.id, seen);
    return { added, updated, removed, skipped };
  }

  private async realRoot(rootPath: string): Promise<string> {
    try {
      const root = await realpath(rootPath);
      if (!(await stat(root)).isDirectory()) throw new RootUnreadableError(rootPath);
      return root;
    } catch {
      throw new RootUnreadableError(rootPath);
    }
  }

  private async processFile(
    library: Library,
    root: string,
    filePath: string,
    skipped: SkippedFile[],
  ): Promise<'added' | 'updated' | 'unchanged' | 'skipped'> {
    const relativePath = relative(root, filePath);
    if (isExtra(relativePath)) {
      skipped.push({ path: relativePath, reason: 'extra' });
      return 'skipped';
    }
    let real: string;
    let size: number;
    let mtimeMs: number;
    try {
      real = await realpath(filePath);
      const info = await stat(real);
      size = info.size;
      mtimeMs = Math.round(info.mtimeMs);
    } catch {
      skipped.push({ path: relativePath, reason: 'unreadable' });
      return 'skipped';
    }
    if (resolveUnderRoot(root, real) === null) {
      skipped.push({ path: relativePath, reason: 'outside_root' });
      return 'skipped';
    }

    const stored = this.repository.findStoredFile(library.id, filePath);
    if (stored && stored.fileSize === size && stored.fileMtimeMs === mtimeMs) return 'unchanged';

    let probed;
    try {
      probed = await this.probe(filePath);
    } catch {
      skipped.push({ path: relativePath, reason: 'probe_failed' });
      return 'skipped';
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
    const input: MediaInput = {
      kind: parsed.kind,
      title: parsed.title,
      year: parsed.year,
      filePath,
      fileSize: size,
      fileMtimeMs: mtimeMs,
      durationSec: probed.durationSec,
      season: parsed.season,
      episode: parsed.episode,
      episodeEnd: parsed.episodeEnd,
      seriesId,
      providerIds: parsed.providerIds,
      edition: parsed.edition,
      part: parsed.part,
    };
    this.repository.upsertMedia(library.id, input, probed.streams);
    return stored ? 'updated' : 'added';
  }
}

/** Thrown when a scan of the same library is already in flight (spec extension *a). */
export class ScanRunningError extends Error {
  constructor(libraryId: string) {
    super(`A scan of library ${libraryId} is already running`);
    this.name = 'ScanRunningError';
  }
}

/** Recursive walk; an unreadable directory is reported and its siblings continue (spec 3a). */
async function walk(dir: string, skipped: SkippedFile[], root = dir): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    skipped.push({ path: relative(root, dir) || '.', reason: 'unreadable' });
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, skipped, root)));
    } else if (SUPPORTED_EXTENSIONS.has(extensionOf(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}
