import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { startWatcherLoop, type LoopTick } from '../src/EventsWatcher.ts';
import { RateLimitedError } from '../src/errors.ts';
import type { WatchEventsStatus } from '../src/types.ts';

const cursor = { since: '2026-08-06T00:00:00Z', lastEventId: '1', seenIds: ['1'] };
const batch = { invalidations: [{ kind: 'mr' as const, ref: '1', cause: 'opened' }], syncedAt: 'x', cursor };

describe('startWatcherLoop', () => {
  test('a null batch is not delivered, a real batch is', async () => {
    const delivered: unknown[] = [];
    await new Promise<void>((resolve) => {
      const dispose = startWatcherLoop(
        (() => {
          let n = 0;
          return async (): Promise<LoopTick> => {
            n++;
            if (n === 3) { setTimeout(() => { dispose(); resolve(); }, 0); }
            return n === 2 ? { batch, cursor } : { batch: null, cursor };
          };
        })(),
        { intervalMs: 5 },
        (b) => delivered.push(b),
      );
    });
    expect(delivered).toEqual([batch]);
  });

  test('nextIntervalMs overrides the configured interval for the following wait', async () => {
    const stamps: number[] = [];
    await new Promise<void>((resolve) => {
      let n = 0;
      const dispose = startWatcherLoop(
        async (): Promise<LoopTick> => {
          stamps.push(Date.now());
          n++;
          if (n === 3) { setTimeout(() => { dispose(); resolve(); }, 0); }
          // first tick asks for a 60ms wait; ticks otherwise run at 5ms
          return { batch: null, cursor, nextIntervalMs: n === 1 ? 60 : undefined };
        },
        { intervalMs: 5 },
        () => {},
      );
    });
    const gap1 = stamps[1]! - stamps[0]!;
    const gap2 = stamps[2]! - stamps[1]!;
    expect(gap1).toBeGreaterThanOrEqual(45); // 60ms requested, jitter is ±10%
    expect(gap2).toBeLessThan(45);           // back to the 5ms configured interval
  });

  test('dispose stops the loop', async () => {
    let ticks = 0;
    const dispose = startWatcherLoop(async () => { ticks++; return { batch: null, cursor }; }, { intervalMs: 5 }, () => {});
    await new Promise((r) => setTimeout(r, 20));
    dispose();
    const at = ticks;
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBe(at);
  });
});

/** Runs one failing tick through the loop and returns its degraded status. */
async function degradedStatusFor(err: unknown): Promise<WatchEventsStatus> {
  return await new Promise<WatchEventsStatus>((resolve) => {
    const dispose = startWatcherLoop(
      async (): Promise<LoopTick> => { throw err; },
      { intervalMs: 5, onStatus: (s) => { dispose(); resolve(s); } },
      () => {},
    );
  });
}

function octokitError(status: number, headers: Record<string, string>): RequestError {
  const request = { method: 'GET' as const, url: 'https://api.github.com/x', headers: {} };
  return new RequestError('Oops', status, {
    request,
    response: { status, url: request.url, headers, data: {}, retryCount: 0 },
  });
}

describe('the watcher reads Octokit\'s shape as rate-limited', () => {
  test('a 403 with no remaining quota', async () => {
    const status = await degradedStatusFor(octokitError(403, { 'x-ratelimit-remaining': '0' }));
    expect(status.cause).toBe('rate-limited');
  });

  test('a 429', async () => {
    const status = await degradedStatusFor(octokitError(429, {}));
    expect(status.cause).toBe('rate-limited');
  });

  test('a 403 with Retry-After', async () => {
    const status = await degradedStatusFor(octokitError(403, { 'retry-after': '5' }));
    expect(status.cause).toBe('rate-limited');
  });

  test('a plain 403 stays an http-error', async () => {
    const status = await degradedStatusFor(octokitError(403, {}));
    expect(status.cause).toBe('http-error');
  });

  // Octokit wraps a fetch rejection (DNS, reset socket) as a 500 with no
  // response: no server answered, so it is a network problem.
  test('a transport failure with no response stays network', async () => {
    const request = { method: 'GET' as const, url: 'https://api.github.com/x', headers: {} };
    const err = new RequestError('fetch failed', 500, { request });
    const status = await degradedStatusFor(err);
    expect(status.cause).toBe('network');
  });

  test('a RateLimitedError', async () => {
    const err = new RateLimitedError('limited', {
      kind: 'primary', resetAt: null, retryAfterMs: null, operation: 'GET /x',
    });
    const status = await degradedStatusFor(err);
    expect(status.cause).toBe('rate-limited');
  });

  test('Retry-After comes from a plain headers object', async () => {
    const before = Date.now();
    const status = await degradedStatusFor(octokitError(429, { 'retry-after': '7' }));
    const delay = new Date(status.nextRetryAt!).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(6_900);
    expect(delay).toBeLessThan(8_000);
  });

  test('Retry-After comes from RateLimitedError.retryAfterMs', async () => {
    const before = Date.now();
    const err = new RateLimitedError('limited', {
      kind: 'secondary', resetAt: null, retryAfterMs: 9_000, operation: 'GET /x',
    });
    const status = await degradedStatusFor(err);
    const delay = new Date(status.nextRetryAt!).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(8_900);
    expect(delay).toBeLessThan(10_000);
  });

  test('a gitbeaker-shaped 429 keeps its classification', async () => {
    const err = Object.assign(new Error('x'), { cause: { response: { status: 429 } } });
    expect((await degradedStatusFor(err)).cause).toBe('rate-limited');
  });
});
