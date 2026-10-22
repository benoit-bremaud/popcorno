import { describe, expect, it } from 'vitest';
import { resolveUnderRoot } from './path-guard.js';

describe('resolveUnderRoot', () => {
  const root = '/srv/media/films';

  it.each([
    ['Matrix (1999)/Matrix (1999).mkv', '/srv/media/films/Matrix (1999)/Matrix (1999).mkv'],
    ['/srv/media/films/a.mkv', '/srv/media/films/a.mkv'],
    ['..foo.mkv', '/srv/media/films/..foo.mkv'],
    ['sub/...hidden/a.mkv', '/srv/media/films/sub/...hidden/a.mkv'],
  ])('accepts %s inside the root', (candidate, expected) => {
    expect(resolveUnderRoot(root, candidate)).toBe(expected);
  });

  it.each([
    ['.'],
    ['..'],
    ['../series/a.mkv'],
    ['sub/../../a.mkv'],
    ['/srv/media/films-private/a.mkv'],
    ['/srv/media'],
    ['/etc/passwd'],
  ])('rejects %s (root itself, traversal, sibling or ancestor)', (candidate) => {
    expect(resolveUnderRoot(root, candidate)).toBeNull();
  });
});
