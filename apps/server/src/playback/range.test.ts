import { describe, expect, it } from 'vitest';
import { parseRange } from './range.js';

describe('parseRange', () => {
  it('returns undefined without a header (whole file)', () => {
    expect(parseRange(undefined, 100)).toBeUndefined();
  });

  it.each([
    ['bytes=0-', { start: 0, end: 99 }],
    ['bytes=10-19', { start: 10, end: 19 }],
    ['bytes=90-500', { start: 90, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-500', { start: 0, end: 99 }],
    [' bytes=5-5 ', { start: 5, end: 5 }],
  ])('parses %s on a 100-byte file', (header, expected) => {
    expect(parseRange(header, 100)).toEqual(expected);
  });

  it.each([
    'bytes=100-',
    'bytes=20-10',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,5-6',
    'items=0-1',
    'bytes=abc-',
  ])('rejects %s as unsatisfiable or malformed', (header) => {
    expect(parseRange(header, 100)).toBeNull();
  });

  it('rejects any range on an empty file', () => {
    expect(parseRange('bytes=-1', 0)).toBeNull();
    expect(parseRange('bytes=0-', 0)).toBeNull();
  });
});
