import { describe, expect, test } from 'bun:test';
import { createUpdateGate, settleStaleFetch } from '../staleFetch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** One status update on the stale path: fetch, then paint what came back through the gate. */
function staleUpdate(
  gate: ReturnType<typeof createUpdateGate>,
  fetched: Promise<string | null>,
  rendered: Array<string | null>,
  stored: string[] = [],
) {
  return gate.run((id) => settleStaleFetch({
    fetch: () => fetched,
    timeoutMs: 10_000,
    store: (fresh) => stored.push(fresh),
    render: (data) => gate.paint(id, () => rendered.push(data)),
    fallback: null,
    onError: () => {},
  }));
}

/** A newer update that paints straight away, as the fresh-cache path does. */
function freshUpdate(gate: ReturnType<typeof createUpdateGate>, value: string, rendered: Array<string | null>) {
  return gate.run(async (id) => { gate.paint(id, () => rendered.push(value)); });
}

describe('createUpdateGate with settleStaleFetch', () => {
  test('a slow fetch for a branch already switched away from stores its data but does not repaint', async () => {
    const gate = createUpdateGate();
    const rendered: Array<string | null> = [];
    const stored: string[] = [];
    const slow = deferred<string | null>();

    const first = staleUpdate(gate, slow.promise, rendered, stored);
    await staleUpdate(gate, Promise.resolve('branch-b'), rendered, stored);
    slow.resolve('branch-a');
    await first;

    expect(rendered).toEqual(['branch-b']);
    expect(stored).toEqual(['branch-b', 'branch-a']);
  });

  test('a newer update that rejects before painting lets the older result paint when it lands', async () => {
    const gate = createUpdateGate();
    const rendered: Array<string | null> = [];
    const slow = deferred<string | null>();

    const first = staleUpdate(gate, slow.promise, rendered);
    await expect(gate.run(async () => { throw new Error('no repo'); })).rejects.toThrow('no repo');
    slow.resolve('branch-a');
    await first;

    expect(rendered).toEqual(['branch-a']);
  });

  test('a newer update that rejects after the older result landed paints the held older result', async () => {
    const gate = createUpdateGate();
    const rendered: Array<string | null> = [];
    const newer = deferred<void>();

    const first = staleUpdate(gate, Promise.resolve('branch-a'), rendered);
    const second = gate.run(() => newer.promise);
    await first;
    expect(rendered).toEqual([]);

    newer.reject(new Error('no repo'));
    await expect(second).rejects.toThrow('no repo');
    expect(rendered).toEqual(['branch-a']);
  });

  test('once a newer update has painted, an even newer one rejecting never brings the older result back', async () => {
    const gate = createUpdateGate();
    const rendered: Array<string | null> = [];
    const slow = deferred<string | null>();

    const first = staleUpdate(gate, slow.promise, rendered);
    await freshUpdate(gate, 'branch-b', rendered);
    await expect(gate.run(async () => { throw new Error('no repo'); })).rejects.toThrow('no repo');
    slow.resolve('branch-a');
    await first;

    expect(rendered).toEqual(['branch-b']);
  });

  test('isLatest follows the newest update still running, not one that rejected', async () => {
    const gate = createUpdateGate();
    let firstId = 0;
    const held = deferred<void>();
    const first = gate.run(async (id) => { firstId = id; await held.promise; });
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(gate.isLatest(firstId)).toBe(true);
    held.resolve();
    await first;
  });
});

describe('settleStaleFetch', () => {
  test('renders its fetch, or the fallback when the fetch gives nothing', async () => {
    const rendered: Array<string | null> = [];
    const base = { timeoutMs: 10_000, store: () => {}, render: (d: string | null) => rendered.push(d), onError: () => {} };
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
      store: () => {},
      render: (d) => rendered.push(d),
      fallback: 'cached',
      onError: () => {},
    });
    expect(rendered).toEqual(['cached']);
  });
});
