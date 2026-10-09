import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enrichPost = vi.fn();

vi.mock('./../api', () => ({
  client: {
    api: { runs: { enrich: { $post: (...a: unknown[]) => enrichPost(...a) } } },
  },
}));

const { useRunsEnrich } = await import('./useRuns');

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useRunsEnrich', () => {
  beforeEach(() => {
    enrichPost.mockReset();
  });

  it('asks in batches the server accepts and merges the answers', async () => {
    enrichPost.mockImplementation(
      async (arg: { json: { branches: string[] } }) => {
        const branches = arg.json.branches;
        return {
          ok: branches.length <= 100,
          status: branches.length <= 100 ? 200 : 400,
          json: async () =>
            Object.fromEntries(
              branches.map(b => [b, { ticket: { title: `t ${b}` } }])
            ),
        };
      }
    );
    const branches = Array.from(
      { length: 230 },
      (_, i) => `b${String(i).padStart(3, '0')}`
    );
    const { result } = renderHook(() => useRunsEnrich(branches), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(enrichPost).toHaveBeenCalledTimes(3);
    for (const [arg] of enrichPost.mock.calls)
      expect(arg.json.branches.length).toBeLessThanOrEqual(100);
    expect(Object.keys(result.current.data ?? {})).toHaveLength(230);
    expect(result.current.data?.b229?.ticket?.title).toBe('t b229');
  });
});
