import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ client: {} }));

const { useRunEvents } = await import('./useRuns');

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
  }
}

function harness() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidate, Wrap };
}

const keys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(c => (c[0] as { queryKey: string[] }).queryKey[0]);

describe('useRunEvents', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refreshes runs, run and gates on every message', () => {
    const { invalidate, Wrap } = harness();
    renderHook(() => useRunEvents(), { wrapper: Wrap });
    act(() => FakeSocket.all[0]!.onmessage?.());
    expect(keys(invalidate)).toEqual(['runs', 'run', 'gates']);
  });

  it('reopens a dropped socket and catches up on what it missed', () => {
    const { invalidate, Wrap } = harness();
    renderHook(() => useRunEvents(), { wrapper: Wrap });
    act(() => FakeSocket.all[0]!.onopen?.());
    act(() => FakeSocket.all[0]!.onclose?.());
    expect(FakeSocket.all).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.all).toHaveLength(2);
    expect(invalidate).not.toHaveBeenCalled();

    act(() => FakeSocket.all[1]!.onopen?.());
    expect(keys(invalidate)).toEqual(['runs', 'run', 'gates']);
  });

  it('backs off between failed reopens', () => {
    const { Wrap } = harness();
    renderHook(() => useRunEvents(), { wrapper: Wrap });
    act(() => FakeSocket.all[0]!.onclose?.());
    act(() => vi.advanceTimersByTime(1_000));
    act(() => FakeSocket.all[1]!.onclose?.());
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.all).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('stops reopening once unmounted', () => {
    const { Wrap } = harness();
    const { unmount } = renderHook(() => useRunEvents(), { wrapper: Wrap });
    const first = FakeSocket.all[0]!;
    unmount();
    expect(first.closed).toBe(true);
    act(() => first.onclose?.());
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.all).toHaveLength(1);
  });
});
