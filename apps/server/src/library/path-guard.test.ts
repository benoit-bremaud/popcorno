import { describe, expect, it } from 'vitest';
import { resolveUnderRoot } from './path-guard.js';

describe('resolveUnderRoot', () => {
  const root = '/srv/media/films';

  it('accepts a relative path inside the root', () => {
    expect(resolveUnderRoot(root, 'Matrix (1999)/Matrix (1999).mkv')).toBe(
      '/srv/media/films/Matrix (1999)/Matrix (1999).mkv',
    );
  });

  it('accepts an absolute path inside the root', () => {
    expect(resolveUnderRoot(root, '/srv/media/films/a.mkv')).toBe('/srv/media/films/a.mkv');
  });

  it('rejects the root itself, traversal and sibling folders', () => {
    expect(resolveUnderRoot(root, '.')).toBeNull();
    expect(resolveUnderRoot(root, '../series/a.mkv')).toBeNull();
    expect(resolveUnderRoot(root, 'sub/../../a.mkv')).toBeNull();
    expect(resolveUnderRoot(root, '/srv/media/films-private/a.mkv')).toBeNull();
    expect(resolveUnderRoot(root, '/etc/passwd')).toBeNull();
  });
});
