import { Spotlight } from '@mattstack/app-kit/spotlight';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../icons';

import { paletteStatus } from './paletteStatus';

const runsGet = vi.fn();
const gatesGet = vi.fn();
const enrichPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        $get: (...args: unknown[]) => runsGet(...args),
        enrich: { $post: (...args: unknown[]) => enrichPost(...args) },
      },
      gates: { $get: (...args: unknown[]) => gatesGet(...args) },
    },
  },
}));

const { ConsolePalette } = await import('./ConsolePalette');

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: over.id ?? 'run-x',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'failed',
  current_stage: null,
  spawned_by: null,
  started_at: 0,
  ended_at: 1,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: null,
  branch: null,
  ...over,
});

const waitingGate = (runId: string): GateRow =>
  ({
    id: `g-${runId}`,
    subject: `run:${runId}`,
    kind: 'plan',
    status: 'open',
    owner: 'human',
    openedAt: 0,
    questions: [],
    answer: null,
  }) as unknown as GateRow;

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function renderPalette() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConsolePalette />
    </QueryClientProvider>
  );
}

async function typeQuery(text: string) {
  Spotlight.open();
  await userEvent.type(
    await screen.findByPlaceholderText('Search runs, or jump to a page…'),
    text
  );
}

beforeEach(() => {
  gatesGet.mockResolvedValue(ok({ gates: [] }));
  enrichPost.mockResolvedValue(ok({}));
});

afterEach(() => {
  Spotlight.close();
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
});

describe('paletteStatus', () => {
  it('puts a gate waiting on you first, then where the run stands', () => {
    const live = run({ id: 'l', ended_at: null, status: 'running' });
    expect(paletteStatus(live, new Set(['l']))).toEqual({
      label: 'waiting on you',
      color: 'bad',
    });
    expect(paletteStatus(live, new Set()).label).toBe('running');
    expect(
      paletteStatus(
        run({
          ended_at: null,
          attention: { needs: true, reason: 'stale', evidence: '' },
        }),
        new Set()
      ).label
    ).toBe('stale');
    expect(paletteStatus(run({ status: 'done' }), new Set()).label).toBe(
      'done'
    );
    expect(paletteStatus(run({ status: 'abandoned' }), new Set())).toEqual({
      label: 'abandoned',
      color: 'gray',
    });
  });
});

describe('ConsolePalette', () => {
  it('lists matching runs by ticket, title and status, then where to go', async () => {
    runsGet.mockResolvedValue(
      ok({
        runs: [
          run({
            id: 'run-418',
            ticket: 'WEB-418',
            branch: 'web-418-filter',
            status: 'running',
            ended_at: null,
          }),
          run({ id: 'run-9', ticket: 'WEB-9', status: 'done' }),
        ],
      })
    );
    gatesGet.mockResolvedValue(ok({ gates: [waitingGate('run-418')] }));
    enrichPost.mockResolvedValue(
      ok({
        'web-418-filter': {
          ticket: { identifier: 'WEB-418', title: 'Filter by assignee' },
          mr: null,
          fetchedAt: 0,
        },
      })
    );

    renderPalette();
    await typeQuery('418');

    const row = await screen.findByTestId('palette-run-run-418');
    await waitFor(() => expect(row).toHaveTextContent('Filter by assignee'));
    expect(row).toHaveTextContent('WEB-418');
    await waitFor(() => expect(row).toHaveTextContent('waiting on you'));
    expect(row).not.toHaveTextContent('web-418-filter');
    expect(screen.queryByTestId('palette-run-run-9')).toBeNull();

    expect(screen.getByText('Runs', { selector: '[data-parity="t"]' }));
    expect(screen.getByText('Go to')).toBeInTheDocument();
    expect(screen.getByText('Search runs for “418”')).toBeInTheDocument();
    for (const key of ['↑↓ move', '↵ open', 'esc close'])
      expect(screen.getByText(key)).toBeInTheDocument();
    await waitFor(() => expect(row).toHaveAttribute('data-selected'));
    expect(within(row).getByText('↵')).toBeInTheDocument();
  });

  it('searches the runs page for what you typed', async () => {
    runsGet.mockResolvedValue(ok({ runs: [] }));

    renderPalette();
    await typeQuery('assignee filter');

    await userEvent.click(
      await screen.findByText('Search runs for “assignee filter”')
    );
    expect(location.pathname).toBe('/search');
    expect(new URLSearchParams(location.search).get('q')).toBe(
      'assignee filter'
    );
  });

  it('shows nothing until you start typing', async () => {
    runsGet.mockResolvedValue(
      ok({ runs: [run({ id: 'run-1', ticket: 'RT-44' })] })
    );

    renderPalette();
    Spotlight.open();
    const input = await screen.findByPlaceholderText(
      'Search runs, or jump to a page…'
    );
    await vi.waitFor(() => expect(runsGet).toHaveBeenCalled());

    expect(screen.queryByTestId('palette-run-run-1')).toBeNull();
    expect(screen.queryByText('Go to')).toBeNull();

    await userEvent.type(input, 'RT');
    expect(await screen.findByTestId('palette-run-run-1')).toBeInTheDocument();
  });

  it('caps the runs at ten', async () => {
    runsGet.mockResolvedValue(
      ok({
        runs: Array.from({ length: 15 }, (_, i) =>
          run({ id: `run-${i}`, ticket: `RT-${i}` })
        ),
      })
    );

    renderPalette();
    await typeQuery('repo-tools');

    await screen.findByTestId('palette-run-run-0');
    expect(screen.getAllByTestId(/^palette-run-/)).toHaveLength(10);
  });

  it('offers no settings keys: typing "config" finds no runs', async () => {
    runsGet.mockResolvedValue(ok({ runs: [] }));

    renderPalette();
    await typeQuery('config');

    expect(
      await screen.findByText('Search runs for “config”')
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^palette-run-/)).toHaveLength(0);
    expect(screen.queryByText(/rt\.runsPruneDays/)).toBeNull();
  });
});
