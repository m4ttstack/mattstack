import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  GateRow,
  RunDetail,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../icons';

const runsGet = vi.fn();
const gatesGet = vi.fn();
const runGet = vi.fn();

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
          ':runId': { $get: (...args: unknown[]) => runGet(...args) },
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

const stage = (
  name: string,
  status: string,
  started_at: number,
  ended_at: number | null
): RunStageRow => ({
  name,
  status,
  attempt: 1,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
});

const LIVE_STAGES = [
  stage('plan', 'done', at(13, 38), at(14)),
  stage('implement', 'running', at(15, 48), null),
];
const MERGED_STAGES = [
  stage('plan', 'done', at(11, 42), at(12, 40)),
  stage('implement', 'done', at(12, 40), at(14, 12)),
];
const YDAY_STAGES = [stage('plan', 'done', at(13, 46, 7), at(16, 51, 7))];

const summaryStages = (stages: RunStageRow[]) =>
  stages.map(s => ({
    name: s.name,
    status: s.status,
    started_at: s.started_at,
    ended_at: s.ended_at,
  }));

const RUNS: RunSummary[] = [
  run({
    id: 'live',
    ticket: 'WEB-412',
    current_stage: 'implement',
    started_at: at(13, 38),
    stages: summaryStages(LIVE_STAGES),
  }),
  run({
    id: 'merged',
    ticket: 'WEB-409',
    status: 'done',
    started_at: at(11, 42),
    ended_at: at(14, 12),
    last_event_at: at(14, 12),
    outcome: {
      status: 'done',
      mr: { iid: 405, state: 'merged', url: null, mergedAt: at(14, 14) },
    },
  }),
  run({
    id: 'yday',
    ticket: 'WEB-376',
    status: 'done',
    started_at: at(13, 46, 7),
    ended_at: at(16, 51, 7),
    last_event_at: at(16, 51, 7),
  }),
];

const OTHER = run({
  id: 'other',
  repo: 'remote:acme%2Fapi',
  ticket: 'API-7',
  status: 'done',
  started_at: at(10),
  ended_at: at(11),
  last_event_at: at(11),
});

const STAGES: Record<string, RunStageRow[]> = {
  other: [stage('plan', 'done', at(10), at(11))],
  live: LIVE_STAGES,
  merged: MERGED_STAGES,
  yday: YDAY_STAGES,
};

const answer = (
  id: string,
  runId: string,
  by: string,
  openedAt: number,
  answeredAt: number,
  owner = 'human'
): GateRow =>
  ({
    id,
    subject: `run:${runId}`,
    kind: 'plan',
    status: 'answered',
    owner,
    openedAt,
    origin: null,
    questions: [
      {
        id: 'q',
        label: 'Which approach?',
        multi: false,
        options: [
          { value: 'a', label: 'Server-side filter (Recommended)' },
          { value: 'b', label: `Picked by ${by}` },
        ],
      },
    ],
    answer: { answers: { q: 'b' }, by, answeredAt },
  }) as unknown as GateRow;

const GATES: GateRow[] = [
  answer('g-you', 'merged', 'console', at(12), at(12, 30)),
  answer('g-herd', 'merged', 'shepherd', at(13), at(13, 1), 'herd:acme'),
  answer('g-pane', 'live', 'pane', at(14, 30), at(14, 30)),
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
  history.replaceState(null, '', '/?view=timeline');
  runsGet.mockResolvedValue(ok({ runs: RUNS, asOf: NOW }));
  gatesGet.mockResolvedValue(ok({ gates: GATES }));
  runGet.mockImplementation(
    async ({ param }: { param: { runId: string } }): Promise<unknown> => {
      const r = [...RUNS, OTHER].find(x => x.id === param.runId)!;
      const detail: RunDetail & { asOf: number } = {
        run: r,
        stages: STAGES[param.runId] ?? [],
        fields: [],
        decisions: [],
        schemaAhead: false,
        asOf: NOW,
      };
      return ok(detail);
    }
  );
});

afterEach(() => vi.clearAllMocks());

const rowIds = () =>
  screen
    .getAllByTestId(/^timeline-row-/)
    .map(el => el.dataset.testid!.replace('timeline-row-', ''));

describe('runs page, Day timeline', () => {
  it('draws one row per run active today, each bar in its kind', async () => {
    renderPage();
    const row = await screen.findByTestId('timeline-row-merged');
    expect(rowIds()).toEqual(['live', 'merged']);
    expect(
      document.querySelector('[data-parity="Title row"] [data-parity="title"]')
    ).toHaveTextContent('Today');
    await waitFor(() =>
      expect(
        within(row)
          .getAllByTestId('timeline-bar')
          .map(b => b.dataset.kind)
      ).toEqual(['done', 'you', 'done'])
    );
    const live = screen.getByTestId('timeline-row-live');
    expect(
      within(live)
        .getAllByTestId('timeline-bar')
        .map(b => b.dataset.kind)
    ).toEqual(['done', 'idle', 'running']);
    expect(live).toHaveTextContent('implement · 35m');
    expect(row).toHaveTextContent('merged !405 · 2h 30m');
  });

  it('moves between days in the URL', async () => {
    renderPage();
    await screen.findByTestId('timeline-row-live');
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() => expect(rowIds()).toEqual(['yday']));
    expect(location.search).toBe('?view=timeline&day=2026-10-07');
    expect(screen.getByText('Yesterday')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(rowIds()).toEqual(['live', 'merged']));
    expect(location.search).toBe('?view=timeline');
  });

  it('adds up where the time went to the bars', async () => {
    renderPage();
    await screen.findByTestId('timeline-row-merged');
    // live: 22m plan, 1h 48m idle, 35m implement; merged: 18m + 1h 42m
    // stage work around 30m waiting on you.
    await waitFor(() =>
      expect(screen.getByTestId('total-work')).toHaveTextContent(
        '2h 57mStage work'
      )
    );
    expect(screen.getByTestId('total-you')).toHaveTextContent(
      '30mWaiting on you'
    );
    expect(screen.getByTestId('total-idle')).toHaveTextContent(
      '1h 48mIdle or held'
    );
    expect(screen.getByTestId('total-ci')).toHaveTextContent('0mWaiting on CI');
    expect(screen.getByTestId('day-timeline')).toHaveTextContent(
      'waiting for you: 30m today.'
    );
  });

  it('lists the decisions you made today, never a shepherd’s', async () => {
    renderPage();
    const card = await screen.findByTestId('decisions-today');
    await waitFor(() =>
      expect(card).toHaveTextContent('Decisions you made today · 2')
    );
    expect(
      within(card)
        .getAllByTestId(/^decision-/)
        .map(el => el.dataset.testid)
    ).toEqual(['decision-g-pane', 'decision-g-you']);
    expect(card).toHaveTextContent('WEB-412Picked by pane');
    expect(card).not.toHaveTextContent('Picked by shepherd');
    expect(card).not.toHaveTextContent(/see all/i);
  });

  it('keeps to the repo the page is filtered to', async () => {
    runsGet.mockResolvedValue(ok({ runs: [...RUNS, OTHER], asOf: NOW }));
    gatesGet.mockResolvedValue(
      ok({
        gates: [
          ...GATES,
          answer('g-api', 'other', 'console', at(10), at(10, 30)),
        ],
      })
    );
    history.replaceState(
      null,
      '',
      `/?view=timeline&repo=${encodeURIComponent('remote:acme%2Fweb')}`
    );
    renderPage();
    await screen.findByTestId('timeline-row-merged');
    expect(rowIds()).toEqual(['live', 'merged']);
    expect(
      document.querySelector('[data-parity="Title row"] [data-parity="sub"]')
    ).toHaveTextContent(/^acme\/web · Thu Oct 8 · /);
    const card = screen.getByTestId('decisions-today');
    await waitFor(() =>
      expect(card).toHaveTextContent('Decisions you made today · 2')
    );
    expect(card).not.toHaveTextContent('API-7');
  });

  it('switches to the list and back', async () => {
    renderPage();
    await screen.findByTestId('day-timeline');
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(await screen.findByTestId('stat-cards')).toBeInTheDocument();
    expect(location.search).toBe('');
    await userEvent.click(screen.getByRole('radio', { name: 'Timeline' }));
    expect(await screen.findByTestId('day-timeline')).toBeInTheDocument();
  });
});
