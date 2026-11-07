import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date(2026, 10, 6, 18, 47).getTime();
const MIN = 60_000;

const listGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      gates: { slack: { $get: (...args: unknown[]) => listGet(...args) } },
    },
  },
}));

const { SlackRailEntry } = await import('./SlackRailEntry');

const gate = (id: string, openedAgoMin: number) =>
  ({
    id,
    subject: `slack:${id}`,
    kind: 'slack-open',
    status: 'open',
    meta: null,
    openedAt: NOW - openedAgoMin * MIN,
  }) as unknown as GateRow;

function renderEntry(gates: GateRow[]) {
  listGet.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ gates, trigger: '@Maude' }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <SlackRailEntry active={false} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SlackRailEntry', () => {
  it('counts the requests still waiting', async () => {
    renderEntry([gate('a', 4), gate('b', 20)]);
    expect(await screen.findByTestId('slack-badge')).toHaveTextContent('2');
  });

  it('leaves an expired request out of the count', async () => {
    renderEntry([gate('a', 4), gate('old', 31)]);
    expect(await screen.findByTestId('slack-badge')).toHaveTextContent('1');
  });

  it('shows no badge when every request has expired', async () => {
    renderEntry([gate('old', 45)]);
    await vi.waitFor(() => expect(listGet).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('slack-badge')).toBeNull();
  });
});
