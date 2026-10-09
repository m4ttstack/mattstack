import type { ReactNode } from 'react';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatesGet = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: { gates: { $get: (...args: unknown[]) => gatesGet(...args) } },
  },
}));

const { useLinkedGates } = await import('./useLinkedGates');

const gate = (id: string, subject: string, runId?: string): GateRow =>
  ({
    id,
    subject,
    kind: 'plan',
    questions: [],
    meta: null,
    status: 'answered',
    answer: null,
    openedAt: 0,
    parkedAt: null,
    closedAt: null,
    origin: runId ? { runId } : undefined,
  }) as unknown as GateRow;

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useLinkedGates', () => {
  beforeEach(() => {
    gatesGet.mockReset();
  });

  it('groups every linked gate by its run', async () => {
    gatesGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        gates: [
          gate('a', 'run:r1'),
          gate('b', 'mr:acme/web!412', 'r2'),
          gate('c', 'run:r1'),
          gate('x', 'mr:acme/web!7'),
        ],
      }),
    });
    const { result } = renderHook(() => useLinkedGates(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.all).toHaveLength(3));
    expect(gatesGet).toHaveBeenCalledWith({ query: { linked: '1' } });
    expect(result.current.byRun.get('r1')?.map(g => g.id)).toEqual(['a', 'c']);
    expect(result.current.byRun.get('r2')?.map(g => g.id)).toEqual(['b']);
    expect(result.current.byRun.size).toBe(2);
  });

  it('is empty before the first answer', async () => {
    let release: (v: unknown) => void = () => {};
    gatesGet.mockReturnValue(new Promise(resolve => (release = resolve)));
    const { result } = renderHook(() => useLinkedGates(), {
      wrapper: wrapper(),
    });
    expect(result.current.all).toEqual([]);
    expect(result.current.byRun.size).toBe(0);
    expect(result.current.loaded).toBe(false);
    release({ ok: true, json: async () => ({ gates: [] }) });
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });

  it('reads a failed request as loaded with no gates, so nothing spins forever', async () => {
    gatesGet.mockResolvedValue({ ok: false, status: 502 });
    const { result } = renderHook(() => useLinkedGates(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.all).toEqual([]);
  });
});
