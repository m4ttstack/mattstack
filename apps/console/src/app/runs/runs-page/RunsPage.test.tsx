import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../icons';

const runsGet = vi.fn();
const gatesGet = vi.fn();

const ok = (json: unknown) => ({
  ok: true,
  status: 200,
  json: async () => json,
});

vi.mock('../../api', () => ({
  client: {
    api: {
      runs: {
        $get: (...args: unknown[]) => runsGet(...args),
        ':repo': {
          ':runId': {
            $get: async () =>
              ok({ run: null, stages: [], fields: [], decisions: [] }),
          },
        },
        enrich: { $post: async () => ok({}) },
      },
      gates: { $get: (...args: unknown[]) => gatesGet(...args) },
      settings: { 'runs-prune-days': { $get: async () => ok({ days: 30 }) } },
      panes: { ':id': { focus: { $post: async () => ok({}) } } },
    },
  },
}));

const { RunsPage } = await import('./RunsPage');

const NOW = new Date(2026, 9, 8, 16, 23).getTime();
const at = (h: number, m = 0, day = 8) =>
  new Date(2026, 9, day, h, m).getTime();

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: 'r',
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: at(9),
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: at(9),
  ticket: null,
  branch: null,
  ...over,
});

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g',
    subject: 'run:r',
    kind: 'plan',
    status: 'open',
    owner: 'human',
    openedAt: at(16, 17),
    questions: [
      {
        id: 'approach',
        label: 'Which approach should the plan take?',
        multi: false,
        options: [
          { value: 'server', label: 'Server-side filter (Recommended)' },
          'Client-side filter',
        ],
      },
    ],
    answer: null,
    origin: null,
    ...over,
  }) as GateRow;

const answered = (id: string, runId: string) =>
  gate({
    id,
    subject: `run:${runId}`,
    status: 'answered',
    answer: { answers: {}, by: 'console', answeredAt: at(10) },
  });

const done = (over: Partial<RunSummary>) =>
  run({ status: 'done', last_event_at: over.ended_at ?? 0, ...over });

const RUNS: RunSummary[] = [
  run({
    id: 'waits',
    ticket: 'WEB-418',
    current_stage: 'plan',
    started_at: at(13, 38),
  }),
  run({
    id: 'live',
    ticket: 'WEB-412',
    current_stage: 'implement',
    started_at: at(13, 38),
  }),
  done({
    id: 'merged',
    ticket: 'WEB-409',
    started_at: at(11, 42),
    ended_at: at(14, 12),
    evidence_count: 3,
    outcome: {
      status: 'done',
      mr: { iid: 405, state: 'merged', url: null, mergedAt: at(14, 14) },
    },
  }),
  done({
    id: 'review',
    ticket: 'WEB-388',
    work_type: 'review',
    pipeline: 'review',
    started_at: at(9, 17),
    ended_at: at(9, 40),
    decision_count: 7,
    outcome: {
      status: 'done',
      reviewed: { iid: 412, url: null, posted: 'request changes' },
    },
  }),
  run({
    id: 'stale',
    ticket: 'WEB-366',
    started_at: at(10, 46, 7),
    last_event_at: at(13, 18, 7),
    attention: { needs: true, reason: 'stale', evidence: 'quiet' },
  }),
];

const GATES: GateRow[] = [
  gate({ id: 'g-418', subject: 'run:waits' }),
  answered('a1', 'live'),
  answered('a2', 'live'),
  answered('a3', 'merged'),
  answered('a4', 'review'),
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  runsGet.mockResolvedValue(ok({ runs: RUNS, asOf: NOW }));
  gatesGet.mockResolvedValue(ok({ gates: GATES }));
});

afterEach(() => vi.clearAllMocks());

describe('RunsPage', () => {
  it('fills the stat cards from the runs and their gates', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('stat-oldest')).toHaveTextContent('1 gate · 6m')
    );
    expect(screen.getByTestId('stat-stages')).toHaveTextContent(
      /^Live1implement$/
    );
    expect(screen.getByTestId('stat-split')).toHaveTextContent(
      '1 merged · 1 review posted'
    );
    // The review run is left out of the median: only WEB-409 counts.
    expect(screen.getByTestId('stat-window')).toHaveTextContent(
      'Median work run2h 30mlast 1 work run'
    );
  });

  it('shows my oldest gate read-only and jumps to it on g', async () => {
    renderPage();
    const banner = await screen.findByTestId('waiting-banner');
    expect(banner).toHaveTextContent('WEB-418');
    expect(banner).toHaveTextContent('Which approach should the plan take?');
    expect(within(banner).queryByRole('radio')).toBeNull();
    expect(
      within(banner).getByRole('link', { name: /answer gate/i })
    ).toHaveAttribute('href', '/runs/remote:acme%2Fweb/waits#gate-g-418');

    await userEvent.keyboard('g');
    expect(location.pathname).toBe('/runs/remote:acme%2Fweb/waits');
    expect(location.hash).toBe('#gate-g-418');
  });

  it('ignores g while focus is in an input', async () => {
    renderPage();
    await screen.findByTestId('waiting-banner');
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="repo"]'
    )!;
    await userEvent.click(input);
    expect(input).toHaveFocus();
    await userEvent.keyboard('g');
    expect(location.pathname).toBe('/');
    expect(location.hash).toBe('');
  });

  it('ignores g once the banner is gone', async () => {
    const { unmount } = renderPage();
    await screen.findByTestId('waiting-banner');
    await userEvent.click(screen.getByRole('radio', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByTestId('waiting-banner')).toBeNull()
    );
    await userEvent.keyboard('g');
    expect(location.pathname).toBe('/');
    unmount();
    await userEvent.keyboard('g');
    expect(location.pathname).toBe('/');
    expect(location.hash).toBe('');
  });

  it('never puts a herd-owned gate in the banner or the waiting count', async () => {
    gatesGet.mockResolvedValue(
      ok({
        gates: [gate({ id: 'herd', subject: 'run:waits', owner: 'herd:x' })],
      })
    );
    renderPage();
    expect(await screen.findByTestId('lane-waits')).toBeInTheDocument();
    await waitFor(() => expect(gatesGet).toHaveBeenCalled());
    expect(screen.getByTestId('stat-oldest')).toHaveTextContent(
      'nothing waiting'
    );
    expect(screen.queryByTestId('waiting-banner')).toBeNull();
  });

  it('lays out lanes and the earlier rows with gate-counted decisions', async () => {
    renderPage();
    const lane = await screen.findByTestId('lane-live');
    expect(lane).toHaveTextContent('2 decisions');
    expect(screen.queryByTestId('lane-waits')).toBeNull();
    const review = screen.getByTestId('run-row-review');
    expect(review).toHaveTextContent('1 decision');
    expect(review).toHaveTextContent('reviewed !412 · request changes');
    expect(review).toHaveTextContent('—');
    expect(screen.getByTestId('run-row-stale')).toHaveTextContent(
      'stale · no pane'
    );
    expect(screen.getByTestId('run-row-merged')).toHaveTextContent(
      '3 evidence'
    );
  });

  it('marks a review row whose post gate waits in the board', async () => {
    gatesGet.mockResolvedValue(
      ok({
        gates: [
          gate({
            id: 'post',
            subject: 'mr:acme/web!412',
            kind: 'review-post',
            origin: { runId: 'review' } as GateRow['origin'],
          }),
        ],
      })
    );
    renderPage();
    const row = await screen.findByTestId('run-row-review');
    await waitFor(() =>
      expect(within(row).getByTestId('waiting-in-board')).toBeInTheDocument()
    );
    expect(screen.getByTestId('stat-oldest')).toHaveTextContent(
      'nothing waiting'
    );
  });

  it('keeps the filter in the url and shows only what it admits', async () => {
    renderPage();
    await screen.findByTestId('lane-live');

    await userEvent.click(screen.getByRole('radio', { name: 'Done' }));
    expect(location.search).toBe('?filter=done');
    await waitFor(() => expect(screen.queryByTestId('lane-live')).toBeNull());
    expect(screen.queryByTestId('waiting-banner')).toBeNull();
    expect(screen.getByTestId('run-row-merged')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Live' }));
    expect(location.search).toBe('?filter=live');
    await waitFor(() => expect(screen.queryByTestId('earlier')).toBeNull());
    expect(screen.getByTestId('lane-live')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-banner')).toBeInTheDocument();
  });

  it('says nothing is running when no run is live', async () => {
    runsGet.mockResolvedValue(
      ok({ runs: RUNS.filter(r => r.status !== 'running'), asOf: NOW })
    );
    gatesGet.mockResolvedValue(ok({ gates: [] }));
    renderPage();
    expect(await screen.findByText('Nothing running.')).toBeInTheDocument();
    expect(screen.getByTestId('stat-stages')).toHaveTextContent(
      'nothing running'
    );
    expect(screen.queryByTestId('waiting-banner')).toBeNull();
    expect(screen.getByText(/Live · 0/i)).toBeInTheDocument();
  });

  it('names no repo count when there are no runs', async () => {
    runsGet.mockResolvedValue(ok({ runs: [], asOf: NOW }));
    gatesGet.mockResolvedValue(ok({ gates: [] }));
    renderPage();
    expect(
      await screen.findByText('every pipeline run on this Mac')
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 repos/)).toBeNull();
  });

  it('keeps the outage on screen while the next poll is in flight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const outage = {
        ok: false,
        status: 502,
        json: async () => ({ error: 'daemon unreachable' }),
      };
      runsGet.mockResolvedValue(outage);
      gatesGet.mockResolvedValue(outage);
      renderPage();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await screen.findByTestId('runs-outage')).toBeInTheDocument();
      runsGet.mockReturnValue(new Promise(() => {}));
      const calls = runsGet.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(runsGet.mock.calls.length).toBeGreaterThan(calls);
      expect(screen.getByTestId('runs-outage')).toBeInTheDocument();
      expect(
        within(screen.getByTestId('stat-cards')).getAllByText('—')
      ).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws a skeleton while the runs load, never zeros', async () => {
    runsGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByTestId('runs-skeleton')).toBeInTheDocument();
    const stats = screen.getByTestId('stat-cards');
    expect(stats).not.toHaveTextContent(/\d/);
    expect(stats).not.toHaveTextContent('nothing');
    expect(screen.queryByText('Nothing running.')).toBeNull();
    expect(screen.queryByText(/Live · 0/)).toBeNull();
  });

  it('says it cannot reach the daemon on an outage, with dashes for the numbers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      runsGet.mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'daemon unreachable' }),
      });
      gatesGet.mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'daemon unreachable' }),
      });
      renderPage();
      await vi.advanceTimersByTimeAsync(2_000);
      const banner = await screen.findByTestId('runs-outage');
      expect(banner).toHaveTextContent("Can't reach the rt daemon");
      expect(runsGet).toHaveBeenCalledTimes(2);
      const stats = screen.getByTestId('stat-cards');
      expect(stats).not.toHaveTextContent(/\d/);
      expect(within(stats).getAllByText('—')).toHaveLength(4);
      expect(screen.getByTestId('runs-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('Nothing running.')).toBeNull();

      runsGet.mockResolvedValue(ok({ runs: RUNS, asOf: NOW }));
      gatesGet.mockResolvedValue(ok({ gates: GATES }));
      await userEvent.click(
        within(banner).getByRole('button', { name: 'Retry' })
      );
      await waitFor(() =>
        expect(screen.queryByTestId('runs-outage')).toBeNull()
      );
      expect(screen.getByTestId('lane-live')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
