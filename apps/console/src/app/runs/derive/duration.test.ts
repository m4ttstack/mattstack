import { describe, expect, it } from 'vitest';

import { formatDuration } from './duration';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('formatDuration', () => {
  it('rounds a short span up to one minute', () => {
    expect(formatDuration(0)).toBe('1m');
    expect(formatDuration(20_000)).toBe('1m');
  });
  it('counts minutes under an hour', () => {
    expect(formatDuration(44 * MIN)).toBe('44m');
  });
  it('pads minutes after an hour', () => {
    expect(formatDuration(2 * HOUR + 30 * MIN)).toBe('2h 30m');
    expect(formatDuration(3 * HOUR + 5 * MIN)).toBe('3h 05m');
  });
  it('switches to days and hours past a day', () => {
    expect(formatDuration(8 * 24 * HOUR + 3 * HOUR)).toBe('8d 3h');
  });
});
