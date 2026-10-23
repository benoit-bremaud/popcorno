/** Inclusive byte span to stream, `end` < file size. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a `Range` header against the file size (RFC 9110 §14.1.2, one range only):
 * `undefined` when there is no header (send the whole file), a span when it is
 * satisfiable, null when it is malformed, multi-range or past the end (→ 416, spec 4d).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | undefined {
  if (header === undefined) return undefined;
  const match = SINGLE_RANGE.exec(header.trim());
  if (match === null) return null;
  const [, first = '', last = ''] = match;
  if (first === '') {
    // Suffix form `bytes=-N`: the last N bytes.
    const length = Number(last);
    if (last === '' || length === 0 || size === 0) return null;
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || end < start) return null;
  return { start, end };
}
