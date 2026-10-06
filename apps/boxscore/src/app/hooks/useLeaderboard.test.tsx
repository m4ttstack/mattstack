import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLeaderboard } from './useLeaderboard';

const { leaderboardGet } = vi.hoisted(() => ({ leaderboardGet: vi.fn() }));

vi.mock('../api', () => ({
  client: { api: { leaderboard: { $get: leaderboardGet } } },
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

describe('useLeaderboard', () => {
  beforeEach(() => {
    leaderboardGet.mockReset();
  });

  it('keeps a preview and the normal view in separate cache entries', async () => {
    leaderboardGet.mockImplementation(
      async ({ query }: { query: Record<string, string> }) => ({
        json: async () => ({ tag: query.viewAs ?? 'team' }),
      })
    );

    const { result, rerender } = renderHook(
      ({ viewAs }: { viewAs: string | null }) =>
        useLeaderboard(selection, viewAs),
      { wrapper, initialProps: { viewAs: null as string | null } }
    );
    await waitFor(() => expect(result.current.data).toEqual({ tag: 'team' }));
    expect(leaderboardGet.mock.calls[0]![0].query).not.toHaveProperty('viewAs');

    rerender({ viewAs: 'srivera' });
    await waitFor(() =>
      expect(result.current.data).toEqual({ tag: 'srivera' })
    );
    expect(leaderboardGet).toHaveBeenCalledTimes(2);
    expect(leaderboardGet.mock.calls[1]![0].query).toMatchObject({
      viewAs: 'srivera',
      cacheOnly: '1',
    });
  });
});
