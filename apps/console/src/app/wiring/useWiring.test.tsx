import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bindPost = vi.fn();
const surfaceApplyPost = vi.fn();
const syncPost = vi.fn();
const discardPost = vi.fn();
const anatomyGet = vi.fn();
const sourceGet = vi.fn();
const changesGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        sync: { $post: (...args: unknown[]) => syncPost(...args) },
        discard: { $post: (...args: unknown[]) => discardPost(...args) },
        anatomy: { $get: (...args: unknown[]) => anatomyGet(...args) },
        source: { $get: (...args: unknown[]) => sourceGet(...args) },
        changes: { $get: (...args: unknown[]) => changesGet(...args) },
        surface: {
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
      },
    },
  },
}));

const {
  useAnatomy,
  useDiscardChanges,
  usePendingChanges,
  useSkillSource,
  useSkillsApply,
  useSkillsSync,
} = await import('./useWiring');

function reply(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function harness(
  defaultOptions?: ConstructorParameters<typeof QueryClient>[0]
) {
  const queryClient = new QueryClient(
    defaultOptions ?? {
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }
  );
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, Wrap };
}

function invalidatedKeys(invalidate: { mock: { calls: unknown[][] } }) {
  return invalidate.mock.calls.map(
    ([filters]) => (filters as { queryKey: unknown[] }).queryKey
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// `WiringMap` calls `useSkillsApply(pack ?? '')` unconditionally (before
// packs load, `pack` is null) -- the only render path that fires either
// mutation is gated on a truthy pack, but the hook itself must not be a
// trap for a future caller that skips that gate.
describe('useSkillsApply with no pack selected', () => {
  it('rejects a bind without POSTing', async () => {
    const { result } = renderHook(() => useSkillsApply(''), { wrapper });

    act(() => {
      result.current.bind.mutate({ verb: 'v', slot: 's', fill: 'f' });
    });

    await waitFor(() => expect(result.current.bind.isError).toBe(true));
    expect(bindPost).not.toHaveBeenCalled();
  });

  it('rejects a surface apply without POSTing', async () => {
    const { result } = renderHook(() => useSkillsApply(''), { wrapper });

    act(() => {
      result.current.surfaceApply.mutate({ toPublic: [], toInternal: [] });
    });

    await waitFor(() => expect(result.current.surfaceApply.isError).toBe(true));
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });
});

describe('useAnatomy', () => {
  it('requests one skill of one pack', async () => {
    anatomyGet.mockResolvedValue(reply({ skill: 'stage-plan' }));
    const { Wrap } = harness();

    const { result } = renderHook(() => useAnatomy('acme', 'stage-plan'), {
      wrapper: Wrap,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(anatomyGet).toHaveBeenCalledWith({
      query: { pack: 'acme', skill: 'stage-plan' },
    });
  });

  it('makes no request without a pack or a skill', async () => {
    const { Wrap } = harness();

    renderHook(() => useAnatomy(null, 'x'), { wrapper: Wrap });
    renderHook(() => useAnatomy('acme', null), { wrapper: Wrap });

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(anatomyGet).not.toHaveBeenCalled();
  });

  it('surfaces the server error message', async () => {
    anatomyGet.mockResolvedValue(reply({ error: 'no such skill' }, 502));
    const { Wrap } = harness();

    const { result } = renderHook(() => useAnatomy('acme', 'nope'), {
      wrapper: Wrap,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('no such skill');
  });
});

describe('useSkillSource', () => {
  it('requests one file of one pack', async () => {
    sourceGet.mockResolvedValue(
      reply({ path: '/p/a.md', content: '', lines: 0 })
    );
    const { Wrap } = harness();

    const { result } = renderHook(() => useSkillSource('acme', '/p/a.md'), {
      wrapper: Wrap,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(sourceGet).toHaveBeenCalledWith({
      query: { pack: 'acme', path: '/p/a.md' },
    });
  });

  it('does not retry a refused path', async () => {
    sourceGet.mockResolvedValue(
      reply({ error: 'not a skill file of this pack' }, 404)
    );
    const { Wrap } = harness({
      defaultOptions: { queries: { retry: 3, retryDelay: 1 } },
    });

    const { result } = renderHook(() => useSkillSource('acme', '/p/a.md'), {
      wrapper: Wrap,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(sourceGet).toHaveBeenCalledTimes(1);
  });

  it('makes no request without a pack or a path', async () => {
    const { Wrap } = harness();

    renderHook(() => useSkillSource(null, '/p/a.md'), { wrapper: Wrap });
    renderHook(() => useSkillSource('acme', null), { wrapper: Wrap });

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(sourceGet).not.toHaveBeenCalled();
  });
});

describe('usePendingChanges', () => {
  it('reads the pack changes and makes no request without a pack', async () => {
    changesGet.mockResolvedValue(reply({ pack: 'acme', files: [] }));
    const { Wrap } = harness();

    const { result } = renderHook(() => usePendingChanges('acme'), {
      wrapper: Wrap,
    });
    renderHook(() => usePendingChanges(null), { wrapper: Wrap });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(changesGet).toHaveBeenCalledTimes(1);
    expect(changesGet).toHaveBeenCalledWith({ query: { pack: 'acme' } });
  });

  it('reports a failed poll as an error without retrying or throwing', async () => {
    changesGet.mockResolvedValue(reply({ error: 'rt unavailable' }, 503));
    const { Wrap } = harness({
      defaultOptions: { queries: { retry: 3, retryDelay: 1 } },
    });

    const { result } = renderHook(() => usePendingChanges('acme'), {
      wrapper: Wrap,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(changesGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeUndefined();
  });

  it('polls every 15 seconds and refetches on window focus', async () => {
    changesGet.mockResolvedValue(reply({ pack: 'acme', files: [] }));
    const { queryClient, Wrap } = harness();

    const { result } = renderHook(() => usePendingChanges('acme'), {
      wrapper: Wrap,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [observer] = queryClient
      .getQueryCache()
      .find({ queryKey: ['skills', 'changes', 'acme'] })!.observers;
    expect(observer.options.refetchInterval).toBe(15_000);
    expect(observer.options.refetchOnWindowFocus).toBe(true);
  });
});

describe('invalidation after a write', () => {
  it('sweeps anatomy and changes when a bind lands', async () => {
    bindPost.mockResolvedValue(reply({ pack: 'acme', ok: true }));
    const { invalidate, Wrap } = harness();
    const { result } = renderHook(() => useSkillsApply('acme'), {
      wrapper: Wrap,
    });

    act(() => {
      result.current.bind.mutate({ verb: 'v', slot: 's', fill: 'f' });
    });

    await waitFor(() => expect(result.current.bind.isSuccess).toBe(true));
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(['skills', 'anatomy', 'acme']);
    expect(keys).toContainEqual(['skills', 'changes', 'acme']);
    expect(keys).toContainEqual(['skills', 'source', 'acme']);
  });
});

describe('useSkillsSync', () => {
  it('posts commitPending when asked to', async () => {
    syncPost.mockResolvedValue(reply({ pack: 'acme' }));
    const { Wrap } = harness();
    const { result } = renderHook(() => useSkillsSync('acme'), {
      wrapper: Wrap,
    });

    act(() => {
      result.current.mutate({ commitPending: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(syncPost).toHaveBeenCalledWith({
      json: { pack: 'acme', commitPending: true },
    });
  });

  it('posts only the pack when called with no variables', async () => {
    syncPost.mockResolvedValue(reply({ pack: 'acme' }));
    const { Wrap } = harness();
    const { result } = renderHook(() => useSkillsSync('acme'), {
      wrapper: Wrap,
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(syncPost.mock.calls[0]![0].json).toStrictEqual({ pack: 'acme' });
  });
});

describe('useDiscardChanges', () => {
  it('posts the pack and sweeps anatomy and changes', async () => {
    discardPost.mockResolvedValue(reply({ pack: 'acme', discarded: [] }));
    const { invalidate, Wrap } = harness();
    const { result } = renderHook(() => useDiscardChanges('acme'), {
      wrapper: Wrap,
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(discardPost).toHaveBeenCalledWith({ json: { pack: 'acme' } });
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(['skills', 'anatomy', 'acme']);
    expect(keys).toContainEqual(['skills', 'changes', 'acme']);
    expect(keys).toContainEqual(['skills', 'source', 'acme']);
  });

  it('throws the server error on a refusal and still sweeps', async () => {
    discardPost.mockResolvedValue(reply({ error: 'checkout is shared' }, 502));
    const { invalidate, Wrap } = harness();
    const { result } = renderHook(() => useDiscardChanges('acme'), {
      wrapper: Wrap,
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('checkout is shared');
    expect(invalidatedKeys(invalidate)).toContainEqual([
      'skills',
      'changes',
      'acme',
    ]);
  });
});
