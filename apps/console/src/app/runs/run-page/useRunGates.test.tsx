import type { ReactNode } from 'react';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatesGet = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: { gates: { $get: (...args: unknown[]) => gatesGet(...args) } },
  },
}));

const { useRunGates } = await import('./useRunGates');

const gate = (id: string, subject: string, runId?: string): GateRow =>
  ({
    id,
    subject,
    kind: 'plan',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 0,
    parkedAt: null,
    closedAt: null,
    origin: runId ? { runId } : undefined,
  }) as unknown as GateRow;

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, Wrap };
}

describe('useRunGates', () => {
  beforeEach(() => gatesGet.mockReset());

  it('asks the daemon for the run and keeps only that run', async () => {
    gatesGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        gates: [
          gate('a', 'run:r1'),
          gate('b', 'mr:acme/web!412', 'r1'),
          gate('c', 'run:r2'),
          gate('d', 'mr:acme/web!9', 'r2'),
        ],
      }),
    });
    const { Wrap } = harness();
    const { result } = renderHook(() => useRunGates('r1'), { wrapper: Wrap });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(gatesGet).toHaveBeenCalledWith({ query: { run: 'r1' } });
    expect(result.current.gates.map(g => g.id)).toEqual(['a', 'b']);
  });

  it('refetches when the gates topic invalidates', async () => {
    gatesGet.mockResolvedValue({
      ok: true,
      json: async () => ({ gates: [gate('a', 'run:r1')] }),
    });
    const { Wrap, queryClient } = harness();
    const { result } = renderHook(() => useRunGates('r1'), { wrapper: Wrap });
    await waitFor(() => expect(result.current.gates).toHaveLength(1));
    gatesGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        gates: [gate('a', 'run:r1'), gate('e', 'run:r1')],
      }),
    });
    await act(() => queryClient.invalidateQueries({ queryKey: ['gates'] }));
    await waitFor(() => expect(result.current.gates).toHaveLength(2));
  });

  it('says the read failed rather than reading as no gates', async () => {
    gatesGet.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'daemon unreachable' }),
    });
    const { Wrap } = harness();
    const { result } = renderHook(() => useRunGates('r1'), { wrapper: Wrap });
    await waitFor(() => expect(result.current.failed).toBe(true), {
      timeout: 3000,
    });
    expect(result.current.gates).toEqual([]);
    expect(gatesGet).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refused read', async () => {
    gatesGet.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'no such run' }),
    });
    const { Wrap } = harness();
    const { result } = renderHook(() => useRunGates('r1'), { wrapper: Wrap });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(gatesGet).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known gates when a later read fails', async () => {
    gatesGet.mockResolvedValue({
      ok: true,
      json: async () => ({ gates: [gate('a', 'run:r1')] }),
    });
    const { Wrap, queryClient } = harness();
    const { result } = renderHook(() => useRunGates('r1'), { wrapper: Wrap });
    await waitFor(() => expect(result.current.gates).toHaveLength(1));
    gatesGet.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'gone' }),
    });
    await act(() => queryClient.invalidateQueries({ queryKey: ['gates'] }));
    await waitFor(() => expect(gatesGet).toHaveBeenCalledTimes(2));
    expect(result.current.gates.map(g => g.id)).toEqual(['a']);
    expect(result.current.failed).toBe(false);
  });
});
