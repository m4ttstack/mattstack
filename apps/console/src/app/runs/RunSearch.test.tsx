import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../icons';

const runsGet = vi.fn();
const pruneDaysGet = vi.fn();
const gatesGet = vi.fn();
const enrichPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        $get: (...args: unknown[]) => runsGet(...args),
        enrich: { $post: (...args: unknown[]) => enrichPost(...args) },
      },
      settings: {
        'runs-prune-days': {
          $get: (...args: unknown[]) => pruneDaysGet(...args),
        },
      },
      gates: { $get: (...args: unknown[]) => gatesGet(...args) },
    },
  },
}));

const { RunSearch, searchCount } = await import('./RunSearch');

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: over.id ?? 'run-x',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'failed',
  current_stage: null,
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: null,
  branch: null,
  ...over,
});

const RUNS: RunSummary[] = [
  run({
    id: 'run-1',
    ticket: 'RT-44',
    branch: 'feat/events-bus',
    status: 'failed',
  }),
  run({
    id: 'run-2',
    repo: 'console',
    ticket: 'RT-9',
    branch: 'feat/x',
    status: 'done',
  }),
];

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function renderSearch(search = '') {
  history.replaceState(null, '', `/search${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunSearch />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  gatesGet.mockResolvedValue(ok({ gates: [] }));
  enrichPost.mockResolvedValue(ok({}));
  pruneDaysGet.mockResolvedValue(ok({ days: 30 }));
});

afterEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
});

describe('searchCount', () => {
  it('counts the runs and names the window', () => {
    expect(searchCount(2, 30)).toBe('2 runs · last 30 days');
    expect(searchCount(1, 1)).toBe('1 run · last 1 day');
    expect(searchCount(3, undefined)).toBe('3 runs');
  });
});

describe('RunSearch', () => {
  it('counts the results in the window the server resolved, not a hardcoded one', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));
    pruneDaysGet.mockResolvedValue(ok({ days: 45 }));

    renderSearch();

    const notice = await screen.findByTestId('retention-window');
    await waitFor(() =>
      expect(notice).toHaveTextContent('2 runs · last 45 days')
    );
  });

  it('names the rt verb that produced these results', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));

    renderSearch();

    expect(await screen.findByTestId('command-provenance')).toHaveTextContent(
      'rt runs'
    );
  });

  it('starts from the query in the link and keeps the link in step', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));

    renderSearch('?q=console');

    await screen.findByTestId('run-row-run-2');
    expect(screen.queryByTestId('run-row-run-1')).toBeNull();
    expect(screen.getByTestId('retention-window')).toHaveTextContent(
      '1 run · last 30 days'
    );
    const input = screen.getByTestId('run-search-input');
    expect(input).toHaveValue('console');

    await userEvent.type(input, ' done');
    expect(location.search).toBe('?q=console+done');
  });

  // Narrowing, proven the same way search.test.ts proves it: a query that
  // widens the result set (rather than narrowing it) is the failure this
  // guards against.
  it('narrows results as more terms are typed, never widens', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));

    renderSearch();
    await screen.findByTestId('run-row-run-1');
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument();

    const input = screen.getByTestId('run-search-input');
    await userEvent.type(input, 'repo-tools');

    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-2')).not.toBeInTheDocument();

    await userEvent.type(input, ' done');

    expect(screen.queryByTestId('run-row-run-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-2')).not.toBeInTheDocument();
    expect(screen.getByText('No runs match.')).toBeInTheDocument();
  });

  it('titles rows by ticket or MR, never the branch', async () => {
    runsGet.mockResolvedValue(
      ok({
        runs: [
          run({ id: 'w', ticket: 'WEB-418', branch: 'web-418-filter' }),
          run({
            id: 'r',
            work_type: 'review',
            pipeline: 'review',
            branch: 'dedupe-contacts',
          }),
        ],
      })
    );
    enrichPost.mockResolvedValue(
      ok({
        'web-418-filter': {
          ticket: { identifier: 'WEB-418', title: 'Filter by assignee' },
          mr: null,
          fetchedAt: 0,
        },
        'dedupe-contacts': {
          ticket: null,
          mr: { iid: 412, webUrl: null, state: 'opened', pipeline: null },
          fetchedAt: 0,
        },
      })
    );

    renderSearch();

    const work = await screen.findByTestId('run-row-w');
    await waitFor(() => expect(work).toHaveTextContent('Filter by assignee'));
    expect(work).not.toHaveTextContent('web-418-filter');
    const review = screen.getByTestId('run-row-r');
    expect(review).toHaveTextContent('Review of !412');
    expect(review).not.toHaveTextContent('dedupe-contacts');
  });

  it('sits on the page surface, not graph paper', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));

    renderSearch();

    await screen.findByTestId('run-search');
    expect(document.querySelector('#page-shell-content')).toHaveAttribute(
      'data-own-surface'
    );
    expect(
      document.querySelector('[data-parity="Search"] [data-parity="h"]')
    ).toHaveTextContent('Search');
  });
});

describe('RunSearch: chrome', () => {
  it("draws its title row at console's page header height, not the kit default", async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));
    renderSearch();

    await screen.findByRole('heading', { level: 2 });
    const header = document.querySelector('#page-shell-header') as HTMLElement;
    expect(header.style.height).toContain('2.5rem');
    const heading = document.querySelector(
      '#page-shell-header h2'
    ) as HTMLElement;
    expect(heading.style.getPropertyValue('--title-fz')).toContain('h5');
  });
});
