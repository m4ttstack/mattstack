import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgSync } from '../../shared/settings-sync';

vi.mock('../api', () => ({ client: {} }));

const { useRunEvents } = await import('../runs/useRuns');
const { followUpFor } = await import('./useSettingsSync');

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev?: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
  constructor() {
    FakeSocket.all.push(this);
  }
}

const frame = (topic: string) => ({
  data: JSON.stringify({
    id: 1,
    topic,
    payload: { slug: 'acme' },
    emittedAt: 1,
  }),
});

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

describe('settings-sync frames', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refetches on a settings-sync frame', () => {
    const { invalidate, Wrap } = harness();
    renderHook(() => useRunEvents(), { wrapper: Wrap });
    act(() => FakeSocket.all[0]!.onmessage?.(frame('team-snapshot-updated')));
    expect(keys(invalidate)).toEqual(['settings-sync']);
    act(() => vi.advanceTimersByTime(5_000));
    expect(keys(invalidate)).toEqual(['settings-sync']);
  });

  it('a runs frame does not refetch sync', () => {
    const { invalidate, Wrap } = harness();
    renderHook(() => useRunEvents(), { wrapper: Wrap });
    act(() => FakeSocket.all[0]!.onmessage?.(frame('run-updated')));
    act(() => vi.advanceTimersByTime(1_000));
    expect(keys(invalidate)).toEqual(['runs', 'run', 'gates']);
  });
});

const SAVE = { key: 'board.slack', store: 'team:web', at: 1_000 };

function sync(over: Partial<OrgSync> = {}): OrgSync {
  return {
    org: 'acme',
    state: { kind: 'pushed', lastPushAt: 500 },
    pending: [],
    cantPush: [],
    lastPushAt: 500,
    pullIntervalSec: 300,
    trialBranch: null,
    ...over,
  };
}

describe('followUpFor', () => {
  it('reads saved before the daemon has seen the change', () => {
    expect(followUpFor(sync(), SAVE)).toBe('saved');
    expect(followUpFor(undefined, SAVE)).toBe('saved');
  });

  it('pushing while the key is pending', () => {
    const s = sync({
      state: { kind: 'waiting', count: 1 },
      pending: [{ store: 'team:web', key: 'board.slack', change: 'changed' }],
    });
    expect(followUpFor(s, SAVE)).toBe('pushing');
  });

  it('pushed once it leaves pending after the save', () => {
    expect(
      followUpFor(
        sync({
          lastPushAt: 2_000,
          state: { kind: 'pushed', lastPushAt: 2_000 },
        }),
        SAVE
      )
    ).toBe('pushed');
  });

  it('save follow-up ends on stuck after a failed push', () => {
    const s = sync({
      state: { kind: 'stuck', reason: 'push-failed', detail: 'fatal: 403' },
      pending: [{ store: 'team:web', key: 'board.slack', change: 'changed' }],
    });
    expect(followUpFor(s, SAVE)).toEqual({
      stuck: 'push-failed',
      detail: 'fatal: 403',
    });
  });

  it('a repo override matches by repo and key', () => {
    const pending = [
      {
        store: 'team:web' as const,
        repo: 'gh/acme/web',
        key: 'board.slack',
        change: 'changed' as const,
      },
    ];
    const s = sync({ state: { kind: 'waiting', count: 1 }, pending });
    expect(followUpFor(s, { ...SAVE, repo: 'gh/acme/web' })).toBe('pushing');
    expect(followUpFor(s, SAVE)).toBe('saved');
    expect(followUpFor(s, { ...SAVE, repo: 'gh/acme/api' })).toBe('saved');
  });

  it('a key on another store does not count', () => {
    const s = sync({
      state: { kind: 'waiting', count: 1 },
      pending: [{ store: 'org', key: 'board.slack', change: 'changed' }],
    });
    expect(followUpFor(s, SAVE)).toBe('saved');
  });
});
