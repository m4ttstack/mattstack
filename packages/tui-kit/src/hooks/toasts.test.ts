import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToasts } from './index.ts';

/**
 * useToasts is a real React hook (useState/useRef/useCallback), and this file
 * lives in the node tier (no DOM/jsdom here -- see vitest.node.config.ts).
 * react-test-renderer renders to a plain JS object tree rather than the DOM,
 * so it can drive the hook's state through act() without a browser.
 *
 * The harness component stashes the hook's latest return value into `latest`
 * on every render; tests read `latest` after each act() to see the settled
 * state.
 */
function renderUseToasts() {
  let latest!: ReturnType<typeof useToasts>;
  function Harness() {
    latest = useToasts();
    return null;
  }
  act(() => {
    create(createElement(Harness));
  });
  return {
    get current() {
      return latest;
    },
  };
}

describe('useToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addToast assigns increasing ids', () => {
    const hook = renderUseToasts();
    act(() => {
      hook.current.addToast('first');
    });
    act(() => {
      hook.current.addToast('second');
    });
    expect(hook.current.toasts).toEqual([
      { id: 1, text: 'first' },
      { id: 2, text: 'second' },
    ]);
  });

  it('entries drop after the 3500ms timeout', () => {
    const hook = renderUseToasts();
    act(() => {
      hook.current.addToast('hello');
    });
    expect(hook.current.toasts).toEqual([{ id: 1, text: 'hello' }]);

    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(hook.current.toasts).toEqual([{ id: 1, text: 'hello' }]);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.current.toasts).toEqual([]);
  });

  it('removes only the timed-out toast, leaving later ones', () => {
    const hook = renderUseToasts();
    act(() => {
      hook.current.addToast('early');
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      hook.current.addToast('late');
    });
    // "early" was added at t=0, "late" at t=1000; advance to just past
    // early's 3500ms deadline (t=3501) but well before late's (t=4500).
    act(() => {
      vi.advanceTimersByTime(2501);
    });
    expect(hook.current.toasts).toEqual([{ id: 2, text: 'late' }]);
  });

  it('startToast holds a pending toast until done, then shows the check for 2s', () => {
    const hook = renderUseToasts();
    let handle!: ReturnType<typeof hook.current.startToast>;
    act(() => {
      handle = hook.current.startToast('merging !1…');
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(hook.current.toasts).toEqual([
      { id: 1, text: 'merging !1…', state: 'pending' },
    ]);

    act(() => {
      handle.done('merge accepted !1');
    });
    expect(hook.current.toasts).toEqual([
      { id: 1, text: 'merge accepted !1', state: 'done' },
    ]);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(hook.current.toasts).toEqual([]);
  });

  it('fail turns the pending toast into a failed one that leaves after 3500ms', () => {
    const hook = renderUseToasts();
    let handle!: ReturnType<typeof hook.current.startToast>;
    act(() => {
      handle = hook.current.startToast('rebasing !1…');
    });
    act(() => {
      handle.fail("couldn't rebase !1");
    });
    expect(hook.current.toasts).toEqual([
      { id: 1, text: "couldn't rebase !1", state: 'failed' },
    ]);
    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(hook.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.current.toasts).toEqual([]);
  });

  it('a pending toast whose work never answers leaves after 30s, and a late result still shows', () => {
    const hook = renderUseToasts();
    let handle!: ReturnType<typeof hook.current.startToast>;
    act(() => {
      handle = hook.current.startToast('stuck…');
    });
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(hook.current.toasts).toEqual([]);
    act(() => {
      handle.fail("couldn't merge !1 (502)");
    });
    expect(hook.current.toasts).toEqual([
      { id: 2, text: "couldn't merge !1 (502)", state: 'failed' },
    ]);
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(hook.current.toasts).toEqual([]);
  });

  it('a second settle is ignored', () => {
    const hook = renderUseToasts();
    let handle!: ReturnType<typeof hook.current.startToast>;
    act(() => {
      handle = hook.current.startToast('merging !1…');
    });
    act(() => {
      handle.done('merge accepted !1');
      handle.fail("couldn't merge !1");
    });
    expect(hook.current.toasts).toEqual([
      { id: 1, text: 'merge accepted !1', state: 'done' },
    ]);
  });
});
