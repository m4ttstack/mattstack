import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatClock, nowOf } from './clock';

describe('nowOf', () => {
  afterEach(() => vi.useRealTimers());

  it('reads the server clock a response carries', () => {
    expect(nowOf({ asOf: 1_000 })).toBe(1_000);
  });

  it('falls back to this clock when the response carries none', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    expect(nowOf({})).toBe(5_000);
    expect(nowOf(undefined)).toBe(5_000);
  });
});

describe('formatClock', () => {
  it('reads hour and minute in the viewer locale', () => {
    const at = new Date(2026, 9, 8, 13, 41).getTime();
    expect(formatClock(at)).toBe(
      new Date(at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    );
    expect(formatClock(at)).toMatch(/41/);
  });
});
