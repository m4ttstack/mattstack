import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RateLimitedError } from '../src/errors.ts';
import { createRealtimeWatcher, type WatcherStatus } from '../src/RealtimeWatcher.ts';

const realSetTimeout = globalThis.setTimeout;

interface Captured {
  fn: () => unknown;
  ms: number;
}

let timers: Captured[] = [];

beforeEach(() => {
  timers = [];
  globalThis.setTimeout = ((fn: () => unknown, ms?: number) => {
    timers.push({ fn, ms: ms ?? 0 });
    return realSetTimeout(() => {}, 0);
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
});

const flush = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));

const lastDelay = (): number => {
  const t = timers.at(-1);
  if (!t) throw new Error('no timer scheduled');
  return t.ms;
};

describe('createRealtimeWatcher poll-only mode', () => {
  test('first update already carries polling', async () => {
    const log: string[] = [];
    const dispose = createRealtimeWatcher({
      fetch: async () => 1,
      onUpdate: () => log.push('update'),
      onStatusChange: (s) => log.push(`status:${s.connection}`),
    });
    await flush();
    dispose();
    expect(log.slice(0, 2)).toEqual(['status:polling', 'update']);
  });

  test('healthy poll waits pollIntervalMs with at most 10% jitter', async () => {
    const dispose = createRealtimeWatcher({
      fetch: async () => 1,
      onUpdate: () => {},
      options: { pollIntervalMs: 60_000 },
    });
    await flush();
    const delay = lastDelay();
    dispose();
    expect(delay).toBeGreaterThanOrEqual(54_000);
    expect(delay).toBeLessThanOrEqual(66_000);
  });

  test('a failed poll retries no sooner than pollIntervalMs', async () => {
    const statuses: WatcherStatus[] = [];
    const dispose = createRealtimeWatcher({
      fetch: async () => {
        throw new Error('boom');
      },
      onUpdate: () => {},
      onStatusChange: (s) => statuses.push(s),
      options: { pollIntervalMs: 60_000 },
    });
    await flush();
    const delay = lastDelay();
    dispose();
    expect(delay).toBeGreaterThanOrEqual(60_000);
    const last = statuses.at(-1);
    expect(last?.connection).toBe('reconnecting');
    expect(last?.consecutiveErrors).toBe(1);
    expect(last?.lastError?.message).toBe('boom');
  });

  test('a RateLimitedError waits for retryAfterMs when later', async () => {
    const dispose = createRealtimeWatcher({
      fetch: async () => {
        throw new RateLimitedError('limited', {
          kind: 'secondary',
          resetAt: null,
          retryAfterMs: 300_000,
          operation: 'x',
        });
      },
      onUpdate: () => {},
      options: { pollIntervalMs: 60_000 },
    });
    await flush();
    const delay = lastDelay();
    dispose();
    expect(delay).toBeGreaterThanOrEqual(300_000);
  });

  test('a RateLimitedError without retryAfterMs waits until resetAt', async () => {
    const resetAt = new Date(Date.now() + 600_000).toISOString();
    const dispose = createRealtimeWatcher({
      fetch: async () => {
        throw new RateLimitedError('limited', {
          kind: 'primary',
          resetAt,
          retryAfterMs: null,
          operation: 'x',
        });
      },
      onUpdate: () => {},
      options: { pollIntervalMs: 60_000 },
    });
    await flush();
    const delay = lastDelay();
    dispose();
    expect(delay).toBeGreaterThan(590_000);
  });

  test('recovery returns to polling', async () => {
    const statuses: WatcherStatus[] = [];
    let calls = 0;
    const dispose = createRealtimeWatcher({
      fetch: async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return 1;
      },
      onUpdate: () => {},
      onStatusChange: (s) => statuses.push(s),
    });
    await flush();
    const tick = timers.at(-1);
    if (!tick) throw new Error('no retry scheduled');
    await tick.fn();
    await flush();
    dispose();
    expect(calls).toBe(2);
    const last = statuses.at(-1);
    expect(last?.connection).toBe('polling');
    expect(last?.consecutiveErrors).toBe(0);
    expect(last?.lastError).toBeUndefined();
  });

  test('a null fetch reports polling and delivers nothing', async () => {
    const statuses: WatcherStatus[] = [];
    let updates = 0;
    const dispose = createRealtimeWatcher<number>({
      fetch: async () => null,
      onUpdate: () => updates++,
      onStatusChange: (s) => statuses.push(s),
    });
    await flush();
    dispose();
    expect(updates).toBe(0);
    expect(statuses.some((s) => s.connection === 'polling')).toBe(true);
  });

  test('dispose before the first fetch resolves delivers nothing', async () => {
    let resolveFetch: (v: number) => void = () => {};
    const log: string[] = [];
    const dispose = createRealtimeWatcher<number>({
      fetch: () =>
        new Promise<number>((resolve) => {
          resolveFetch = resolve;
        }),
      onUpdate: () => log.push('update'),
      onStatusChange: (s) => log.push(`status:${s.connection}`),
    });
    dispose();
    resolveFetch(1);
    await flush();
    expect(log).toEqual([]);
  });
});

describe('createRealtimeWatcher push mode', () => {
  test('push mode keeps its fast first retry', async () => {
    const dispose = createRealtimeWatcher({
      subscribe: () => () => {},
      fetch: async () => {
        throw new Error('boom');
      },
      onUpdate: () => {},
    });
    await flush();
    const delay = lastDelay();
    dispose();
    expect(delay).toBeLessThan(2_000);
  });
});
