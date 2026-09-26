import { describe, test, expect } from 'bun:test';
import { SnapshotCache } from '../src/server/cache.ts';

function make(results: Array<() => Promise<string>>) {
  let i = 0;
  let calls = 0;
  const fetcher = () => {
    calls++;
    const fn = results[Math.min(i, results.length - 1)]!;
    i++;
    return fn();
  };
  return { fetcher, calls: () => calls };
}

describe('SnapshotCache', () => {
  test('serves cached data within TTL without refetching', async () => {
    let now = 0;
    const { fetcher, calls } = make([() => Promise.resolve('a')]);
    const cache = new SnapshotCache(fetcher, 'empty', () => now, 60_000);
    expect((await cache.get()).data).toBe('a');
    now = 30_000;
    expect((await cache.get()).data).toBe('a');
    expect(calls()).toBe(1);
  });

  test('serves stale data after TTL and revalidates in the background', async () => {
    let now = 0;
    const { fetcher, calls } = make([() => Promise.resolve('a'), () => Promise.resolve('b')]);
    const cache = new SnapshotCache(fetcher, 'empty', () => now, 60_000);
    await cache.get();
    now = 61_000;
    expect((await cache.get()).data).toBe('a');
    await Bun.sleep(0);
    expect((await cache.get()).data).toBe('b');
    expect(calls()).toBe(2);
  });

  test('invalidate() blocks until fresh data arrives', async () => {
    const { fetcher } = make([() => Promise.resolve('a'), () => Promise.resolve('b')]);
    const cache = new SnapshotCache(fetcher, 'empty');
    await cache.get();
    cache.invalidate();
    expect((await cache.get()).data).toBe('b');
  });

  test('a failed refresh keeps the last good data and stamps fetchError', async () => {
    let now = 0;
    const { fetcher } = make([() => Promise.resolve('a'), () => Promise.reject(new Error('boom'))]);
    const cache = new SnapshotCache(fetcher, 'empty', () => now, 60_000);
    await cache.get();
    now = 61_000;
    await cache.get();
    await Bun.sleep(0);
    const snap = await cache.get();
    expect(snap.data).toBe('a');
    expect(snap.fetchError).toBe('boom');
  });

  test('a first-fetch failure serves emptyData with fetchError', async () => {
    const { fetcher } = make([() => Promise.reject(new Error('down'))]);
    const cache = new SnapshotCache(fetcher, 'empty');
    const snap = await cache.get();
    expect(snap.data).toBe('empty');
    expect(snap.fetchError).toBe('down');
  });

  test('markStale() serves current data and forces a refetch', async () => {
    const { fetcher, calls } = make([() => Promise.resolve('a'), () => Promise.resolve('b')]);
    const cache = new SnapshotCache(fetcher, 'empty');
    await cache.get();
    cache.markStale();
    expect((await cache.get()).data).toBe('a');
    await Bun.sleep(0);
    expect((await cache.get()).data).toBe('b');
    expect(calls()).toBe(2);
  });
});
