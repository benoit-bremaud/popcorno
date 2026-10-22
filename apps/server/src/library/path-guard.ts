import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Returns the absolute form of `candidate` when it stays strictly under `root`, else null.
 * Pure string reasoning on already-resolved paths: the caller passes the real path
 * (symlinks followed) so a link to `/etc` is caught too. Spec extension 4a.
 */
export function resolveUnderRoot(root: string, candidate: string): string | null {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, absolute);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return absolute;
}
