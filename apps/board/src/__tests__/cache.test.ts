import { describe, expect, test } from 'bun:test';

import { SnapshotCache, type FetchResult } from '../cache.ts';

/** Wrap a bare mrs array as the FetchResult shape SnapshotCache expects. */
function fetchResult(mrs: unknown[]): FetchResult {
  return {
    mrs: mrs as FetchResult['mrs'],
    dataSyncedAt: null,
    scopeUncovered: [],
    scopeWindowDays: null,
    scopeUncoveredSections: [],
    scopeKnownSections: null,
    syncError: null,
  };
}

describe('SnapshotCache forced-refresh failure', () => {
  // The incident: during a daemon-side outage the user mashed refresh. Each
  // forced refresh nulled the snapshot before fetching, so the failure path
  // (which falls back to the previous snapshot) had nothing to fall back to
  // and returned an empty board with a fresh-looking fetchedAt instead of
  // stale-data-plus-banner.
  test('keeps the previous MRs, sets fetchError, and does not fake freshness', async () => {
    let fail = false;
    let t = 1000;
    const cache = new SnapshotCache(
      async () => {
        if (fail) throw new Error('project sync failed: gitlab timeout');
        return fetchResult([{ iid: 1 } as any]);
      },
      () => t
    );
    await cache.forceRefresh(); // seed a good snapshot at t=1000

    fail = true;
    t = 2000;
    const snap = await cache.forceRefresh(); // failing forced refresh

    expect(snap.mrs).toEqual([{ iid: 1 }] as any); // stale beats empty
    expect(snap.fetchError).toContain('gitlab timeout');
    expect(snap.fetchedAt).toBe(1000); // no fresh-looking timestamp over stale data
  });
});

describe('SnapshotCache failed-refresh backoff', () => {
  const TTL = 60_000;
  const BACKOFF = 30_000;
  const settle = () => new Promise(r => setTimeout(r, 0));

  function cacheWith(fail: { on: boolean }, t: { now: number }) {
    const counter = { calls: 0 };
    const cache = new SnapshotCache(
      async () => {
        counter.calls++;
        if (fail.on) throw new Error('daemon down');
        return fetchResult([{ iid: 1 } as any]);
      },
      () => t.now,
      TTL,
      BACKOFF
    );
    return { cache, counter };
  }

  test('serves the last good snapshot without refetching until the backoff passes', async () => {
    const fail = { on: false };
    const t = { now: 0 };
    const { cache, counter } = cacheWith(fail, t);
    await cache.forceRefresh();
    fail.on = true;
    t.now = TTL + 1000;
    await cache.get();
    await settle();
    expect(counter.calls).toBe(2);

    t.now += BACKOFF - 1;
    const snap = await cache.get();
    await cache.get();
    await settle();
    expect(counter.calls).toBe(2);
    expect(snap.mrs).toEqual([{ iid: 1 }] as any);
    expect(snap.fetchError).toContain('daemon down');

    t.now += 1;
    await cache.get();
    await settle();
    expect(counter.calls).toBe(3);
  });

  test('a manual refresh is not held by the backoff', async () => {
    const fail = { on: false };
    const t = { now: 0 };
    const { cache, counter } = cacheWith(fail, t);
    await cache.forceRefresh();
    fail.on = true;
    t.now = 1000;
    await cache.forceRefresh();
    t.now = 2000;
    await cache.forceRefresh();
    expect(counter.calls).toBe(3);
  });

  test('a successful refresh clears the backoff', async () => {
    const fail = { on: true };
    const t = { now: 0 };
    const { cache, counter } = cacheWith(fail, t);
    await cache.get();
    fail.on = false;
    await cache.forceRefresh();
    cache.markStale();
    t.now = 1000;
    await cache.get();
    await settle();
    expect(counter.calls).toBe(3);
  });

  test('a config change during the backoff refetches on the next read', async () => {
    const fail = { on: false };
    const t = { now: 0 };
    const { cache, counter } = cacheWith(fail, t);
    await cache.forceRefresh();
    fail.on = true;
    t.now = TTL + 1000;
    await cache.get();
    await settle();
    expect(counter.calls).toBe(2);

    fail.on = false;
    cache.markStale();
    t.now += 1000;
    await cache.get();
    await settle();
    expect(counter.calls).toBe(3);
  });
});
