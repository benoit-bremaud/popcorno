import { chmod, mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Library } from '@popcorntv/shared';
import { openDatabase } from '../db/index.js';
import type { AppDatabase } from '../db/index.js';
import type { MetadataInput } from '../metadata/matcher.js';
import { MetadataRepository } from '../metadata/repository.js';
import type { ProbeResult, Prober } from './ffprobe.js';
import { LibraryRepository } from './repository.js';
import { LibraryScanner, RootUnreadableError } from './scanner.js';

const PROBED: ProbeResult = {
  durationSec: 120,
  streams: [{ type: 'video', codec: 'h264', width: 1280, height: 720, language: null }],
};

const NOW = '2026-10-23T10:00:00.000Z';

/** What UC2 writes on a matched series: enough to rename it. */
const SOPRANOS: MetadataInput = {
  tmdbId: 1398,
  title: 'The Sopranos',
  overview: null,
  genres: [],
  releaseDate: null,
  runtimeMin: null,
  voteAverage: null,
  voteCount: null,
  cast: [],
  posterPath: null,
  backdropPath: null,
};

/** A prober that fails for the given path suffixes; one instance per test, nothing leaks. */
function makeProbe(failing: readonly string[] = []) {
  return vi.fn<Prober>(async (filePath) => {
    if (failing.some((suffix) => filePath.endsWith(suffix))) {
      throw new Error('ffprobe exited with code 1');
    }
    return PROBED;
  });
}

async function touch(root: string, relativePath: string): Promise<string> {
  const full = join(root, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, 'x');
  return full;
}

describe('LibraryScanner', () => {
  let root: string;
  let db: AppDatabase;
  let repository: LibraryRepository;
  let probe: ReturnType<typeof makeProbe>;
  let scanner: LibraryScanner;
  let library: Library;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'popcorntv-scan-'));
    db = openDatabase(':memory:');
    repository = new LibraryRepository(db);
    probe = makeProbe();
    scanner = new LibraryScanner(repository, probe, root);
    library = repository.createLibrary({ name: 'Films', rootPath: root, kind: 'films' });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('adds every supported file with its parsed name, relative path and probed streams', async () => {
    await touch(root, 'Interstellar (2014)/Interstellar (2014).mkv');
    await touch(root, 'Home Video.mp4');
    await touch(root, 'notes.txt');

    const report = await scanner.scan(library);

    expect(report).toEqual({ added: 2, updated: 0, removed: 0, skipped: [] });
    const items = repository.listMedia(library.id);
    expect(items.map((item) => [item.title, item.year, item.durationSec])).toEqual([
      ['Home Video', null, 120],
      ['Interstellar', 2014, 120],
    ]);
    expect(items[1]?.streams).toEqual(PROBED.streams);
    expect(items[1]?.relativePath).toBe('Interstellar (2014)/Interstellar (2014).mkv');
  });

  it('groups episodes under a series row created on demand', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    await touch(root, 'Dark (2017)/Season 01/Dark S01E01.mkv');
    await touch(root, 'Dark (2017)/Season 01/Dark S01E02.mkv');

    await scanner.scan(series);

    const items = repository.listMedia(series.id);
    const seriesRow = items.find((item) => item.kind === 'series');
    expect(seriesRow).toMatchObject({ title: 'Dark', year: 2017, relativePath: null });
    const episodes = items.filter((item) => item.kind === 'episode');
    expect(episodes.map((item) => item.episode)).toEqual([1, 2]);
    expect(episodes.every((item) => item.seriesId === seriesRow?.id)).toBe(true);
  });

  it('attaches a later episode to a series TMDB has renamed (grouping by parsed title)', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    await touch(root, 'The Sopranos (1999)/Season 01/The Sopranos S01E01.mkv');
    await scanner.scan(series);
    const metadata = new MetadataRepository(db);
    const row = repository.listMedia(series.id).find((item) => item.kind === 'series');
    metadata.saveMetadata(String(row?.id), { ...SOPRANOS, title: 'Les Soprano' }, NOW);
    await touch(root, 'The Sopranos (1999)/Season 01/The Sopranos S01E02.mkv');

    await scanner.scan(series);

    const rows = repository.listMedia(series.id);
    expect(rows.filter((item) => item.kind === 'series')).toHaveLength(1);
    expect(rows.filter((item) => item.kind === 'episode').map((item) => item.seriesId)).toEqual([
      row?.id,
      row?.id,
    ]);
    expect(rows.find((item) => item.kind === 'series')?.title).toBe('Les Soprano');
  });

  it('takes a provider tag added to the folder of an existing series and queues it again', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    await touch(root, 'Dark (2017)/Season 01/Dark S01E01.mkv');
    await scanner.scan(series);
    const metadata = new MetadataRepository(db);
    const before = repository.listMedia(series.id).find((item) => item.kind === 'series');
    metadata.markLookedUp(String(before?.id), NOW);
    await rename(join(root, 'Dark (2017)'), join(root, 'Dark (2017) [tmdbid-70523]'));

    await scanner.scan(series);

    const after = repository.listMedia(series.id).find((item) => item.kind === 'series');
    expect(after?.id).toBe(before?.id);
    expect(after?.providerIds).toEqual({ tmdb: '70523' });
    expect(metadata.listPending(series.id, false).map((item) => item.id)).toEqual([before?.id]);
  });

  it('keeps two series rows for a remake with the same title and another year', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    await touch(root, 'Doctor Who (1963)/Season 01/Doctor Who S01E01.mkv');
    await touch(root, 'Doctor Who (2005)/Season 01/Doctor Who S01E01.mkv');

    await scanner.scan(series);

    const rows = repository.listMedia(series.id).filter((item) => item.kind === 'series');
    expect(rows.map((row) => row.year).sort()).toEqual([1963, 2005]);
  });

  it('stores both files when two parse to the same film (spec 7a)', async () => {
    await touch(root, 'Heat (1995).mkv');
    await touch(root, 'Heat (1995)/Heat (1995).mp4');

    const report = await scanner.scan(library);

    expect(report.added).toBe(2);
    expect(repository.listMedia(library.id).map((item) => item.title)).toEqual(['Heat', 'Heat']);
  });

  it('does not probe an unchanged file again (spec 7b)', async () => {
    await touch(root, 'A (2000).mkv');
    await scanner.scan(library);

    const report = await scanner.scan(library);

    expect(report).toEqual({ added: 0, updated: 0, removed: 0, skipped: [] });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('re-probes a file whose size changed, mtime kept', async () => {
    const file = await touch(root, 'A (2000).mkv');
    await utimes(file, new Date('2020-01-01'), new Date('2020-01-01'));
    await scanner.scan(library);
    await writeFile(file, 'longer content');
    await utimes(file, new Date('2020-01-01'), new Date('2020-01-01'));

    const report = await scanner.scan(library);

    expect(report).toMatchObject({ added: 0, updated: 1 });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('re-probes a file whose mtime changed, size kept', async () => {
    const file = await touch(root, 'A (2000).mkv');
    await scanner.scan(library);
    await utimes(file, new Date('2030-01-01'), new Date('2030-01-01'));

    const report = await scanner.scan(library);

    expect(report).toMatchObject({ added: 0, updated: 1 });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('removes the row of a file that disappeared', async () => {
    await touch(root, 'A (2000).mkv');
    const gone = await touch(root, 'B (2001).mkv');
    await scanner.scan(library);
    await rm(gone);

    const report = await scanner.scan(library);

    expect(report).toEqual({ added: 0, updated: 0, removed: 1, skipped: [] });
    expect(repository.listMedia(library.id).map((item) => item.title)).toEqual(['A']);
  });

  it('removes a series row once its last episode is gone', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    const only = await touch(root, 'Dark/Season 01/Dark S01E01.mkv');
    await touch(root, 'Keep (2000).mkv');
    await scanner.scan(series);
    await rm(only);

    await scanner.scan(series);

    expect(repository.listMedia(series.id).map((item) => item.kind)).toEqual(['unknown']);
  });

  it('skips extras and a symlink escaping the root', async () => {
    await touch(root, 'Matrix (1999)/Matrix (1999).mkv');
    await touch(root, 'Matrix (1999)/extras/Making of.mkv');
    const outside = await mkdtemp(join(tmpdir(), 'popcorntv-outside-'));
    try {
      await symlink(await touch(outside, 'Secret (2020).mkv'), join(root, 'Secret (2020).mkv'));

      const report = await scanner.scan(library);

      expect(report.added).toBe(1);
      expect(report.skipped).toEqual([
        { path: 'Matrix (1999)/extras/Making of.mkv', reason: 'extra' },
        { path: 'Secret (2020).mkv', reason: 'outside_root' },
      ]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('reports a file ffprobe rejects and keeps its previous row (spec 6a)', async () => {
    await touch(root, 'Broken (2021).mkv');
    await scanner.scan(library);
    scanner = new LibraryScanner(repository, makeProbe(['Broken (2021).mkv']), root);
    await writeFile(join(root, 'Broken (2021).mkv'), 'now corrupt');

    const report = await scanner.scan(library);

    expect(report).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      skipped: [{ path: 'Broken (2021).mkv', reason: 'probe_failed' }],
    });
    expect(repository.listMedia(library.id)).toHaveLength(1);
  });

  it('reports a dangling symlink as unreadable (spec 3a)', async () => {
    await symlink(join(root, 'nowhere.mkv'), join(root, 'Dangling (2000).mkv'));

    const report = await scanner.scan(library);

    expect(report.skipped).toEqual([{ path: 'Dangling (2000).mkv', reason: 'unreadable' }]);
  });

  it('prunes nothing when a file could not be fingerprinted (dangling link, transient error)', async () => {
    await touch(root, 'Kept (2000).mkv');
    await scanner.scan(library);
    await symlink(join(root, 'nowhere.mkv'), join(root, 'Dangling (2000).mkv'));
    await rm(join(root, 'Kept (2000).mkv'));

    const report = await scanner.scan(library);

    expect(report.removed).toBe(0);
    expect(repository.listMedia(library.id)).toHaveLength(1);
  });

  it('refreshes the path-derived fields when a link to the same file is renamed', async () => {
    const target = await touch(root, 'store/video.mkv');
    await symlink(target, join(root, 'Old Name (2000).mkv'));
    await scanner.scan(library);
    await rm(join(root, 'Old Name (2000).mkv'));
    await symlink(target, join(root, 'New Name (2001).mkv'));

    const report = await scanner.scan(library);

    expect(report).toEqual({
      added: 0,
      updated: 1,
      removed: 0,
      skipped: [{ path: 'store/video.mkv', reason: 'duplicate' }],
    });
    const titles = repository.listMedia(library.id).map((item) => [item.title, item.year]);
    expect(titles).toContainEqual(['New Name', 2001]);
    expect(titles).not.toContainEqual(['Old Name', 2000]);
  });

  it('rejects a root that is a link to a folder outside MEDIA_ROOT (spec 2b)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'popcorntv-outside-'));
    try {
      await touch(outside, 'Secret (2000).mkv');
      await symlink(outside, join(root, 'escape'));
      const linked = repository.createLibrary({
        name: 'Escape',
        rootPath: join(root, 'escape'),
        kind: 'films',
      });

      await expect(scanner.scan(linked)).rejects.toThrow('resolves outside MEDIA_ROOT');
      expect(repository.listMedia(linked.id)).toHaveLength(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('stores a symlink inside the root under its real path (spec 4a)', async () => {
    const target = await touch(root, 'Real (2000)/extras/clip.mkv');
    await symlink(target, join(root, 'Linked (2000).mkv'));

    await scanner.scan(library);

    expect(repository.findStoredFile(library.id, target)).not.toBeNull();
    expect(repository.findStoredFile(library.id, join(root, 'Linked (2000).mkv'))).toBeNull();
  });

  it.skipIf(process.getuid?.() === 0)(
    'reports an unreadable sub-directory, continues with its siblings and prunes nothing',
    async () => {
      await touch(root, 'Ok (2000).mkv');
      const stale = await touch(root, 'locked/Stale (2001).mkv');
      await scanner.scan(library);
      await rm(stale);
      await chmod(join(root, 'locked'), 0o000);
      try {
        const report = await scanner.scan(library);

        expect(report).toEqual({
          added: 0,
          updated: 0,
          removed: 0,
          skipped: [{ path: 'locked', reason: 'unreadable' }],
        });
        expect(repository.listMedia(library.id)).toHaveLength(2);
      } finally {
        await chmod(join(root, 'locked'), 0o755);
      }
    },
  );

  it('prunes nothing when the root is empty (unmounted volume)', async () => {
    await touch(root, 'A (2000).mkv');
    await scanner.scan(library);
    await rm(join(root, 'A (2000).mkv'));

    const report = await scanner.scan(library);

    expect(report).toEqual({ added: 0, updated: 0, removed: 0, skipped: [] });
    expect(repository.listMedia(library.id)).toHaveLength(1);
  });

  it('rejects a missing root or a root that is a file', async () => {
    const missing = repository.createLibrary({
      name: 'X',
      rootPath: join(root, 'nope'),
      kind: 'films',
    });
    const file = repository.createLibrary({
      name: 'Y',
      rootPath: await touch(root, 'file.mkv'),
      kind: 'films',
    });

    await expect(scanner.scan(missing)).rejects.toBeInstanceOf(RootUnreadableError);
    await expect(scanner.scan(file)).rejects.toBeInstanceOf(RootUnreadableError);
  });
});
