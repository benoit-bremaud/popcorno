/** Inclusive byte span to stream, `end` < file size. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** What to answer for a `Range` header (spec direct-play 4c / 4d). */
export type RangeRequest =
  | { readonly kind: 'whole' }
  | { readonly kind: 'partial'; readonly range: ByteRange }
  | { readonly kind: 'unsatisfiable' };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;
const WHOLE: RangeRequest = { kind: 'whole' };
const UNSATISFIABLE: RangeRequest = { kind: 'unsatisfiable' };

/**
 * Reads a `Range` header against the file size (RFC 9110 §14.2, one range only). No header,
 * a malformed one or several ranges → `whole` (a server may ignore a Range it does not
 * understand); a valid single range past the end → `unsatisfiable` (416).
 */
export function parseRange(header: string | undefined, size: number): RangeRequest {
  const match = header === undefined ? null : SINGLE_RANGE.exec(header.trim());
  if (match === null) return WHOLE;
  const [, first = '', last = ''] = match;
  if (first === '') {
    // Suffix form `bytes=-N`: the last N bytes.
    if (last === '') return WHOLE;
    const length = Number(last);
    if (length === 0 || size === 0) return UNSATISFIABLE;
    return { kind: 'partial', range: { start: Math.max(0, size - length), end: size - 1 } };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (last !== '' && Number(last) < start) return WHOLE; // Invalid range spec: ignored.
  if (start >= size) return UNSATISFIABLE;
  return { kind: 'partial', range: { start, end } };
}
