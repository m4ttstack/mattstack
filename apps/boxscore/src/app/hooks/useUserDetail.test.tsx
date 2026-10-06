import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserDetail } from './useLeaderboard';

const { detailGet } = vi.hoisted(() => ({ detailGet: vi.fn() }));

vi.mock('../api', () => ({
  client: { api: { detail: { $get: detailGet } } },
  readOrThrow: async (res: { json: () => Promise<unknown> }) => res.json(),
  selectionQuery: (s: { range: string }) => ({ range: s.range }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const selection = { range: '30d', trend: false };
const respond = (tag: string) => ({ json: async () => ({ tag }) });

describe('useUserDetail', () => {
  beforeEach(() => {
    detailGet.mockReset();
  });

  it('refetches the evidence when the standings are regenerated, keeping the old rows until then', async () => {
    let release!: () => void;
    detailGet.mockResolvedValueOnce(respond('first')).mockReturnValueOnce(
      new Promise(resolve => {
        release = () => resolve(respond('second'));
      })
    );

    const { result, rerender } = renderHook(
      ({ at }: { at: string }) => useUserDetail('srivera', selection, at, null),
      { wrapper, initialProps: { at: '2026-08-31T12:00:00.000Z' } }
    );
    await waitFor(() => expect(result.current.data).toEqual({ tag: 'first' }));

    rerender({ at: '2026-08-31T12:05:00.000Z' });
    expect(detailGet).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ tag: 'first' });

    release();
    await waitFor(() => expect(result.current.data).toEqual({ tag: 'second' }));
  });

  it("never shows one person the previous person's evidence while loading", async () => {
    detailGet
      .mockResolvedValueOnce(respond('sam'))
      .mockReturnValueOnce(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ user }: { user: string }) =>
        useUserDetail(user, selection, '2026-08-31T12:00:00.000Z', null),
      { wrapper, initialProps: { user: 'srivera' } }
    );
    await waitFor(() => expect(result.current.data).toEqual({ tag: 'sam' }));

    rerender({ user: 'nvance' });
    expect(result.current.data).toBeUndefined();
  });

  it("keeps a preview's evidence apart from the normal view's", async () => {
    detailGet.mockImplementation(
      async ({ query }: { query: Record<string, string> }) => ({
        json: async () => ({ tag: query.viewAs ?? 'team' }),
      })
    );
    const at = '2026-08-31T12:00:00.000Z';

    const { result, rerender } = renderHook(
      ({ viewAs }: { viewAs: string | null }) =>
        useUserDetail('srivera', selection, at, viewAs),
      { wrapper, initialProps: { viewAs: null as string | null } }
    );
    await waitFor(() => expect(result.current.data).toEqual({ tag: 'team' }));

    rerender({ viewAs: 'srivera' });
    expect(result.current.data).toBeUndefined();
    await waitFor(() =>
      expect(result.current.data).toEqual({ tag: 'srivera' })
    );
    expect(detailGet.mock.calls[1]![0].query).toMatchObject({
      user: 'srivera',
      viewAs: 'srivera',
    });
  });
});
