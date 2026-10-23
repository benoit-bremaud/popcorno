import { describe, expect, it } from 'vitest';
import { parseRange } from './range.js';

describe('parseRange', () => {
  it.each([
    ['bytes=0-', 0, 99],
    ['bytes=10-19', 10, 19],
    ['bytes=90-500', 90, 99],
    ['bytes=-10', 90, 99],
    ['bytes=-500', 0, 99],
    [' bytes=5-5 ', 5, 5],
  ])('reads %s on a 100-byte file as a partial range', (header, start, end) => {
    expect(parseRange(header, 100)).toEqual({ kind: 'partial', range: { start, end } });
  });

  it.each([
    undefined,
    'bytes=-',
    'bytes=0-1,5-6',
    'items=0-1',
    'bytes=abc-',
    'bytes=1.5-',
    'bytes=20-10',
  ])('answers the whole file for %s (absent, malformed or multi-range)', (header) => {
    expect(parseRange(header, 100)).toEqual({ kind: 'whole' });
  });

  it.each([
    ['bytes=100-', 100],
    ['bytes=5-', 5],
    ['bytes=-0', 100],
    ['bytes=-1', 0],
    ['bytes=0-', 0],
  ])('marks %s on a %i-byte file unsatisfiable', (header, size) => {
    expect(parseRange(header, size)).toEqual({ kind: 'unsatisfiable' });
  });
});
