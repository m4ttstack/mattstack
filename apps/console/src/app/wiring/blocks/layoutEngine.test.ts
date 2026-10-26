import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetLayoutEngine, loadLayoutEngine } from './layoutEngine';
import type { LayoutInput } from './model/elkGraph';
import { LAYOUT_TIMEOUT_MS, useGraphLayout } from './useGraphLayout';

type FakeElk = {
  terminateWorker: ReturnType<typeof vi.fn>;
  layout: (graph: unknown) => Promise<unknown>;
};

const elk = vi.hoisted(() => ({
  made: [] as FakeElk[],
  /** The next constructions to fail, as a worker that never starts. */
  failures: 0,
  layout: (() => new Promise(() => {})) as (graph: unknown) => Promise<unknown>,
}));

vi.mock('elkjs/lib/elk-api', () => ({
  default: class {
    terminateWorker = vi.fn();
    layout = (graph: unknown) => elk.layout(graph);
    constructor() {
      if (elk.failures > 0) {
        elk.failures--;
        throw new Error('no worker');
      }
      elk.made.push(this as unknown as FakeElk);
    }
  },
}));

vi.mock('elkjs/lib/elk-worker.min.js?worker', () => ({ default: class {} }));

// Two loads never overlap here: vitest hands the second of two concurrent
// imports of a mocked module the real one.
const INPUT: LayoutInput = {
  nodes: [{ id: 'a', width: 10, height: 10 }],
  edges: [],
};

describe('loadLayoutEngine', () => {
  beforeEach(() => {
    forgetLayoutEngine();
    elk.made.length = 0;
    elk.failures = 0;
    elk.layout = () => new Promise(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches one engine until it is forgotten', async () => {
    const first = loadLayoutEngine();
    expect(loadLayoutEngine()).toBe(first);
    await first;
    expect(elk.made).toHaveLength(1);
  });

  it('forgets a load that fails, so Retry loads afresh', async () => {
    elk.failures = 1;
    const failed = loadLayoutEngine();
    await expect(failed).rejects.toThrow('no worker');

    const retried = loadLayoutEngine();
    expect(retried).not.toBe(failed);
    await expect(retried).resolves.toBeDefined();
    expect(elk.made).toHaveLength(1);
  });

  it('stops a load that was forgotten while it ran, and the next load starts afresh', async () => {
    const stale = loadLayoutEngine();
    forgetLayoutEngine();
    await expect(stale).rejects.toThrow('dropped');

    const fresh = loadLayoutEngine();
    await fresh;
    expect(elk.made).toHaveLength(2);
    expect(elk.made[0]!.terminateWorker).toHaveBeenCalledOnce();
    expect(elk.made[1]!.terminateWorker).not.toHaveBeenCalled();
    expect(loadLayoutEngine()).toBe(fresh);
  });

  it('a layout that fails drops the engine and its worker, so Retry starts a new one', async () => {
    elk.layout = () => Promise.reject(new Error('worker died'));
    const { result } = renderHook(() => useGraphLayout(INPUT));

    await vi.waitFor(() => expect(result.current.state).toBe('error'));
    expect(elk.made[0]!.terminateWorker).toHaveBeenCalledOnce();

    act(() => result.current.retry());
    await vi.waitFor(() => expect(elk.made).toHaveLength(2));
  });

  it('a layout that never settles drops the engine and its worker at the timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGraphLayout(INPUT));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(elk.made).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAYOUT_TIMEOUT_MS);
    });

    expect(result.current.state).toBe('error');
    expect(elk.made[0]!.terminateWorker).toHaveBeenCalledOnce();
    act(() => result.current.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(elk.made).toHaveLength(2);
  });
});
