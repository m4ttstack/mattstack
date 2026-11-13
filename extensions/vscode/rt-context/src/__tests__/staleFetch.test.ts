import { describe, expect, test } from 'bun:test';
import { settleStaleFetch } from '../staleFetch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('settleStaleFetch', () => {
  test('a slow fetch for a branch already switched away from stores its data but does not repaint', async () => {
    let seq = 0;
    const rendered: Array<string | null> = [];
    const stored: string[] = [];

    const slow = deferred<string | null>();
    const first = ++seq;
    const firstDone = settleStaleFetch({
      fetch: () => slow.promise,
      timeoutMs: 10_000,
      isLatest: () => first === seq,
      store: (fresh) => stored.push(fresh),
      render: (data) => rendered.push(data),
      fallback: null,
      onError: () => {},
    });

    const second = ++seq;
    await settleStaleFetch({
      fetch: async () => 'branch-b',
      timeoutMs: 10_000,
      isLatest: () => second === seq,
      store: (fresh) => stored.push(fresh),
      render: (data) => rendered.push(data),
      fallback: null,
      onError: () => {},
    });

    slow.resolve('branch-a');
    await firstDone;

    expect(rendered).toEqual(['branch-b']);
    expect(stored).toEqual(['branch-b', 'branch-a']);
  });

  test('the latest update renders its fetch, or the fallback when the fetch gives nothing', async () => {
    const rendered: Array<string | null> = [];
    const base = { timeoutMs: 10_000, isLatest: () => true, store: () => {}, render: (d: string | null) => rendered.push(d), onError: () => {} };
    await settleStaleFetch({ ...base, fetch: async () => 'fresh', fallback: 'cached' });
    await settleStaleFetch({ ...base, fetch: async () => null, fallback: 'cached' });
    expect(rendered).toEqual(['fresh', 'cached']);
  });

  test('a failed fetch reports the error and still renders the fallback', async () => {
    const rendered: Array<string | null> = [];
    const errors: string[] = [];
    await settleStaleFetch({
      fetch: async () => { throw new Error('boom'); },
      timeoutMs: 10_000,
      isLatest: () => true,
      store: () => {},
      render: (d) => rendered.push(d),
      fallback: 'cached',
      onError: (message) => errors.push(message),
    });
    expect(errors).toEqual(['boom']);
    expect(rendered).toEqual(['cached']);
  });

  test('a fetch slower than the timeout renders the fallback', async () => {
    const rendered: Array<string | null> = [];
    await settleStaleFetch({
      fetch: () => new Promise<string | null>(() => {}),
      timeoutMs: 5,
      isLatest: () => true,
      store: () => {},
      render: (d) => rendered.push(d),
      fallback: 'cached',
      onError: () => {},
    });
    expect(rendered).toEqual(['cached']);
  });
});
