export interface RefreshCoalescer {
  /** Ask for a refresh after the burst settles. */
  schedule: () => void;
  /** Refresh now, or right after the one in flight. */
  flush: () => void;
  stop: () => void;
}

/**
 * Trailing-debounced refreshes that never overlap: requests that arrive
 * while one is running collapse into a single follow-up. `maxWaitMs` caps
 * how long a steady stream of requests can hold the refresh off.
 */
export function createRefreshCoalescer(
  refresh: () => Promise<unknown>,
  { waitMs, maxWaitMs }: { waitMs: number; maxWaitMs: number }
): RefreshCoalescer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let burstStart: number | null = null;
  let running = false;
  let queued = false;
  let stopped = false;

  const drain = () => {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void refresh()
      .catch(() => {})
      .finally(() => {
        running = false;
        if (queued) {
          queued = false;
          drain();
        }
      });
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    burstStart = null;
    drain();
  };

  const schedule = () => {
    if (stopped) return;
    const now = Date.now();
    burstStart ??= now;
    clearTimeout(timer);
    const delay = Math.min(waitMs, burstStart + maxWaitMs - now);
    timer = setTimeout(flush, Math.max(0, delay));
  };

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };

  return { schedule, flush, stop };
}
