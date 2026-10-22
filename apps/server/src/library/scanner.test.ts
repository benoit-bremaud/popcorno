import { chmod, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Library } from '@popcorno/shared';
import { openDatabase } from '../db/index.js';
import type { Prober } from './ffprobe.js';
import { LibraryRepository } from './repository.js';
import { LibraryScanner, RootUnreadableError, ScanRunningError } from './scanner.js';

const fakeProbe: Prober = vi.fn(async () => ({
  durationSec: 120,
  streams: [{ type: 'video' as const, codec: 'h264', width: 1280, height: 720, language: null }],
}));

async function touch(root: string, relativePath: string): Promise<string> {
  const full = join(root, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, 'x');
  return full;
}

describe('LibraryScanner', () => {
  let root: string;
  let repository: LibraryRepository;
  let scanner: LibraryScanner;
  let library: Library;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'popcorno-scan-'));
    repository = new LibraryRepository(openDatabase(':memory:'));
    scanner = new LibraryScanner(repository, fakeProbe);
    library = repository.createLibrary({ name: 'Films', rootPath: root, kind: 'films' });
    vi.mocked(fakeProbe).mockClear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('adds every supported file with its parsed name and probed streams', async () => {
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
    expect(items[1]?.streams).toEqual([
      { type: 'video', codec: 'h264', width: 1280, height: 720, language: null },
    ]);
    expect(items[1]?.filePath).toBe(join(root, 'Interstellar (2014)/Interstellar (2014).mkv'));
  });

  it('groups episodes under a series row created on demand', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    await touch(root, 'Dark (2017)/Season 01/Dark S01E01.mkv');
    await touch(root, 'Dark (2017)/Season 01/Dark S01E02.mkv');

    await scanner.scan(series);

    const items = repository.listMedia(series.id);
    const seriesRow = items.find((item) => item.kind === 'series');
    expect(seriesRow).toMatchObject({ title: 'Dark', year: 2017, filePath: null });
    const episodes = items.filter((item) => item.kind === 'episode');
    expect(episodes.map((item) => item.episode)).toEqual([1, 2]);
    expect(episodes.every((item) => item.seriesId === seriesRow?.id)).toBe(true);
  });

  it('is idempotent: unchanged files are not probed again, changed ones are updated, missing ones removed', async () => {
    const kept = await touch(root, 'A (2000).mkv');
    const gone = await touch(root, 'B (2001).mkv');
    await scanner.scan(library);
    expect(fakeProbe).toHaveBeenCalledTimes(2);

    await writeFile(kept, 'changed content');
    await utimes(kept, new Date('2030-01-01'), new Date('2030-01-01'));
    await rm(gone);
    const report = await scanner.scan(library);

    expect(report).toEqual({ added: 0, updated: 1, removed: 1, skipped: [] });
    expect(fakeProbe).toHaveBeenCalledTimes(3);
    expect(repository.listMedia(library.id)).toHaveLength(1);

    const third = await scanner.scan(library);
    expect(third).toEqual({ added: 0, updated: 0, removed: 0, skipped: [] });
    expect(fakeProbe).toHaveBeenCalledTimes(3);
  });

  it('removes a series row once its last episode is gone', async () => {
    const series = repository.createLibrary({ name: 'Series', rootPath: root, kind: 'series' });
    const only = await touch(root, 'Dark/Season 01/Dark S01E01.mkv');
    await scanner.scan(series);
    await rm(only);

    await scanner.scan(series);

    expect(repository.listMedia(series.id)).toEqual([]);
  });

  it('skips extras, symlinks escaping the root and files ffprobe rejects', async () => {
    await touch(root, 'Matrix (1999)/Matrix (1999).mkv');
    await touch(root, 'Matrix (1999)/extras/Making of.mkv');
    const outside = await mkdtemp(join(tmpdir(), 'popcorno-outside-'));
    const target = await touch(outside, 'Secret (2020).mkv');
    await symlink(target, join(root, 'Secret (2020).mkv'));
    await touch(root, 'Broken (2021).mkv');
    vi.mocked(fakeProbe).mockImplementationOnce(async () => {
      throw new Error('ffprobe exited with code 1');
    });

    const report = await scanner.scan(library);

    expect(report.added).toBe(1);
    expect(report.skipped).toEqual([
      { path: 'Broken (2021).mkv', reason: 'probe_failed' },
      { path: 'Matrix (1999)/extras/Making of.mkv', reason: 'extra' },
      { path: 'Secret (2020).mkv', reason: 'outside_root' },
    ]);
    await rm(outside, { recursive: true, force: true });
  });

  it('reports an unreadable sub-directory and continues with its siblings', async () => {
    await touch(root, 'Ok (2000).mkv');
    const locked = join(root, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);

    const report = await scanner.scan(library);

    await chmod(locked, 0o755);
    expect(report.added).toBe(1);
    expect(report.skipped).toEqual([{ path: 'locked', reason: 'unreadable' }]);
  });

  it('rejects a missing root', async () => {
    const broken = repository.createLibrary({
      name: 'X',
      rootPath: join(root, 'nope'),
      kind: 'films',
    });

    await expect(scanner.scan(broken)).rejects.toBeInstanceOf(RootUnreadableError);
  });

  it('refuses a concurrent scan of the same library', async () => {
    await touch(root, 'A (2000).mkv');
    let release: () => void = () => undefined;
    vi.mocked(fakeProbe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ durationSec: 1, streams: [] });
        }),
    );

    const first = scanner.scan(library);
    // The probe is reached only after real fs calls; wait for it so `release` is wired.
    await vi.waitFor(() => expect(fakeProbe).toHaveBeenCalledTimes(1));
    expect(scanner.isRunning(library.id)).toBe(true);
    await expect(scanner.scan(library)).rejects.toBeInstanceOf(ScanRunningError);

    release();
    await first;
    expect(scanner.isRunning(library.id)).toBe(false);
  });
});
