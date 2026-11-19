import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRefreshCoalescer } from './refreshCoalescer';

const timing = { waitMs: 1_000, maxWaitMs: 3_000 };

function deferredRefresh() {
  const releases: (() => void)[] = [];
  const refresh = vi.fn(
    () => new Promise<void>(resolve => releases.push(resolve))
  );
  return { refresh, releases };
}

describe('createRefreshCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns a burst into one trailing refresh', () => {
    const refresh = vi.fn(async () => {});
    const c = createRefreshCoalescer(refresh, timing);
    c.schedule();
    vi.advanceTimersByTime(500);
    c.schedule();
    vi.advanceTimersByTime(500);
    c.schedule();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still refreshes a steady stream once the max wait passes', () => {
    const refresh = vi.fn(async () => {});
    const c = createRefreshCoalescer(refresh, timing);
    for (let t = 0; t < 3_000; t += 500) {
      c.schedule();
      vi.advanceTimersByTime(500);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never overlaps refreshes and queues at most one follow-up', async () => {
    const { refresh, releases } = deferredRefresh();
    const c = createRefreshCoalescer(refresh, timing);
    c.flush();
    c.flush();
    c.schedule();
    vi.advanceTimersByTime(1_000);
    c.flush();
    expect(refresh).toHaveBeenCalledTimes(1);

    releases[0]!();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    releases[1]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a refresh fails', async () => {
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue();
    const c = createRefreshCoalescer(refresh, timing);
    c.flush();
    c.flush();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('does nothing once stopped', () => {
    const refresh = vi.fn(async () => {});
    const c = createRefreshCoalescer(refresh, timing);
    c.schedule();
    c.stop();
    vi.advanceTimersByTime(5_000);
    c.flush();
    expect(refresh).not.toHaveBeenCalled();
  });
});
