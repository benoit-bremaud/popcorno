import type { LibraryKind, ProviderIds } from '@popcorno/shared';

/**
 * Pure file-naming parser (ADR-0002) for the Plex / Jellyfin conventions listed in
 * `docs/architecture/specs/library-scan.md` § Technology and data variations.
 * Input is the path relative to the library root; nothing here touches the filesystem.
 */
export interface ParsedName {
  readonly kind: 'film' | 'episode' | 'unknown';
  /** Film title, or series title for an episode. */
  readonly title: string;
  readonly year: number | null;
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeEnd: number | null;
  readonly providerIds: ProviderIds;
  readonly edition: string | null;
  readonly part: number | null;
}

/** Jellyfin extras folder names; only honoured below the title folder (a top-level `Shorts/` is content). */
const EXTRA_FOLDERS = new Set([
  'behind the scenes',
  'deleted scenes',
  'interviews',
  'scenes',
  'samples',
  'shorts',
  'featurettes',
  'clips',
  'other',
  'extras',
  'trailers',
  'theme-music',
  'backdrops',
]);
/** Jellyfin extra suffixes: `-trailer`, `.sample`, `_clip`… (a space is not a separator: `Hot Clip.mkv` is a film). */
const EXTRA_SUFFIX =
  /[-._](trailer|sample|scene|clip|interview|behindthescenes|deleted|deletedscene|featurette|short|other|extra)$/i;
const EXTRA_STEM = /^(trailer|sample|theme)$/i;

const PROVIDER_TAG = /[[{](tmdb|imdb)(?:id)?-([a-z0-9]+)[\]}]/gi;
const EDITION_TAG = /\{edition-([^}]+)\}/i;
/** Jellyfin version suffix right after the year: `Title (1982) - Director's Cut`. */
const EDITION_SUFFIX = /^\s+-\s+(.+)$/;
/** Resolution-like labels are Jellyfin "versions" of the same cut, not editions. */
const RESOLUTION_LABEL = /^(\d{3,4}p|[48]k|uhd|hd|sd)$/i;
const PART_SUFFIX = /[ ._-](?:cd|dvd|part|pt|disc|disk)[ ._-]?(\d+|[a-d])$/i;
const TITLE_YEAR = /^(.*?)\s*\(((?:18|19|20)\d{2})\)/;
const SEASON_FOLDER = /^season\s*(\d+)$/i;
const SPECIALS_FOLDER = /^specials$/i;
const EPISODE_CODE = /\bS(\d{1,2})\s?E(\d{1,3})(?:-?E?(\d{1,3}))?\b/i;
const EPISODE_CODE_X = /\b(\d{1,2})x(\d{2,3})\b/i;

/** True for Plex / Jellyfin extras (spec extension 5b): folders and file suffixes. */
export function isExtra(relativePath: string): boolean {
  const segments = splitPath(relativePath);
  const stem = stripExtension(segments[segments.length - 1] ?? '');
  const subFolders = segments.slice(1, -1);
  return (
    subFolders.some((folder) => EXTRA_FOLDERS.has(folder.toLowerCase())) ||
    EXTRA_SUFFIX.test(stem) ||
    EXTRA_STEM.test(stem)
  );
}

/** Parses a relative path according to the library kind; never throws. */
export function parseMediaName(relativePath: string, kind: LibraryKind): ParsedName {
  const segments = splitPath(relativePath);
  const stem = stripExtension(segments[segments.length - 1] ?? '');
  const folders = segments.slice(0, -1);
  return kind === 'films' ? parseFilm(stem, folders) : parseEpisode(stem, folders);
}

function parseFilm(stem: string, folders: readonly string[]): ParsedName {
  const providerIds = { ...collectProviderIds(stem), ...collectProviderIds(folders.join('/')) };
  const tags = extractTags(stem);
  const fromStem = TITLE_YEAR.exec(tags.rest);
  const parent = folders[folders.length - 1];
  const fromFolder = parent === undefined ? null : TITLE_YEAR.exec(stripTags(parent));
  const match = fromStem ?? fromFolder;
  const title = clean(match?.[1] ?? tags.rest);
  const year = match ? Number(match[2]) : null;
  const edition = tags.edition ?? editionAfter(tags.rest, fromStem);
  return {
    kind: 'film',
    title: title === '' ? stem : title,
    year,
    season: null,
    episode: null,
    episodeEnd: null,
    providerIds,
    edition,
    part: tags.part,
  };
}

function parseEpisode(stem: string, folders: readonly string[]): ParsedName {
  const tags = extractTags(stem);
  const code = EPISODE_CODE.exec(tags.rest);
  const codeX = code ? null : EPISODE_CODE_X.exec(tags.rest);
  const parent = folders[folders.length - 1];
  const seasonFolder = parent === undefined ? null : SEASON_FOLDER.exec(parent);
  const isSpecials = parent !== undefined && SPECIALS_FOLDER.test(parent);
  const showFolder = seasonFolder || isSpecials ? folders[folders.length - 2] : parent;
  const show = showFolder === undefined ? null : TITLE_YEAR.exec(stripTags(showFolder));
  const showTitle = clean(show?.[1] ?? (showFolder === undefined ? '' : stripTags(showFolder)));
  const providerIds = collectProviderIds(showFolder ?? '');

  let season: number | null = null;
  let episode: number | null = null;
  let episodeEnd: number | null = null;
  let titleBeforeCode = '';
  if (code) {
    season = Number(code[1]);
    episode = Number(code[2]);
    episodeEnd = code[3] === undefined ? null : Number(code[3]);
    titleBeforeCode = tags.rest.slice(0, code.index);
  } else if (codeX) {
    season = Number(codeX[1]);
    episode = Number(codeX[2]);
    titleBeforeCode = tags.rest.slice(0, codeX.index);
  } else if (isSpecials) {
    season = 0;
  } else if (seasonFolder) {
    season = Number(seasonFolder[1]);
  }

  if (season === null && episode === null) {
    return {
      kind: 'unknown',
      title: stem,
      year: null,
      season: null,
      episode: null,
      episodeEnd: null,
      providerIds,
      edition: null,
      part: tags.part,
    };
  }
  // The show folder is the Plex / Jellyfin source of truth; the file prefix is a fallback.
  const title = showTitle || clean(titleBeforeCode) || stem;
  return {
    kind: 'episode',
    title,
    year: show ? Number(show[2]) : null,
    season,
    episode,
    episodeEnd:
      episodeEnd !== null && episode !== null && episodeEnd <= episode ? null : episodeEnd,
    providerIds,
    edition: tags.edition,
    part: tags.part,
  };
}

interface Tags {
  readonly rest: string;
  readonly edition: string | null;
  readonly part: number | null;
}

/** Removes provider / edition / part tags from a stem and reports what they held. */
function extractTags(stem: string): Tags {
  let rest = stripTags(stem);
  const editionMatch = EDITION_TAG.exec(stem);
  const partMatch = PART_SUFFIX.exec(rest);
  if (partMatch) rest = rest.slice(0, partMatch.index);
  return {
    rest: rest.trim(),
    edition: editionMatch ? (editionMatch[1]?.trim() ?? null) : null,
    part: partMatch ? partNumber(partMatch[1] ?? '') : null,
  };
}

/** Jellyfin ` - Label` after the year of the file stem, unless it is a resolution label. */
function editionAfter(rest: string, fromStem: RegExpExecArray | null): string | null {
  if (!fromStem) return null;
  const tail = rest.slice(fromStem.index + fromStem[0].length);
  const label = clean(EDITION_SUFFIX.exec(tail)?.[1] ?? '');
  return label === '' || RESOLUTION_LABEL.test(label) ? null : label;
}

function collectProviderIds(text: string): ProviderIds {
  const ids: { tmdb?: string; imdb?: string } = {};
  for (const match of text.matchAll(PROVIDER_TAG)) {
    const provider = match[1]?.toLowerCase();
    const value = match[2];
    if (provider === 'tmdb' && value !== undefined) ids.tmdb = value;
    if (provider === 'imdb' && value !== undefined) ids.imdb = value;
  }
  return ids;
}

function partNumber(raw: string): number {
  const letter = raw.toLowerCase();
  return /^[a-d]$/.test(letter) ? letter.charCodeAt(0) - 96 : Number(raw);
}

function stripTags(text: string): string {
  return text.replace(PROVIDER_TAG, '').replace(EDITION_TAG, '').trim();
}

function clean(text: string): string {
  return text
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]+$/, '')
    .trim();
}

function splitPath(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter((segment) => segment !== '');
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
