import { describe, expect, it } from 'vitest';
import type { WatchProgress } from '@popcorno/shared';
import { formatPosition, resumeAt } from './resume.js';

function progress(positionSec: number, finished = false): WatchProgress {
  return { mediaId: 'm', positionSec, durationSec: 1000, finished, updatedAt: '' };
}

describe('resumeAt', () => {
  it('resumes at a saved, unfinished position', () => {
    expect(resumeAt(progress(754))).toBe(754);
  });

  it.each([
    ['nothing saved', undefined],
    ['under 10 s', progress(9)],
    ['finished', progress(950, true)],
  ])('starts over when %s', (_case, saved) => {
    expect(resumeAt(saved)).toBe(0);
  });
});

describe('formatPosition', () => {
  it.each([
    [0, '0:00'],
    [754, '12:34'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('formats %i s as %s', (seconds, expected) => {
    expect(formatPosition(seconds)).toBe(expected);
  });
});
