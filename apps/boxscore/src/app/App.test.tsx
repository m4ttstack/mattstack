import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureDetail, fixtureLeaderboard } from '../server/fixture/index';
import type { LeaderboardResponse } from '../shared/types';
import { App } from './App';
import type { AppRoute } from './routes';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock('./hooks/useLeaderboard', () => ({ useLeaderboard, useUserDetail }));

const { useRefreshJob } = vi.hoisted(() => ({ useRefreshJob: vi.fn() }));
vi.mock('./hooks/useRefreshJob', () => ({ useRefreshJob }));

const LEADERBOARD: AppRoute = { name: 'leaderboard' };
const { useAppRoute } = vi.hoisted(() => ({ useAppRoute: vi.fn() }));
vi.mock('./routes', () => ({ useAppRoute }));
useAppRoute.mockReturnValue(LEADERBOARD);
afterEach(() => useAppRoute.mockReturnValue(LEADERBOARD));

const EMPTY: LeaderboardResponse = {
  scope: { type: 'group', groupPath: 'acme/eng' },
  window: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-08-31T00:00:00.000Z',
    key: '30d',
  },
  priorWindow: null,
  hasTrend: false,
  baseUrl: 'https://gitlab.example.com',
  currentUser: '',
  generatedAt: '2026-08-31T12:00:00.000Z',
  fromCache: true,
  metricNotes: {},
  leaders: {},
  users: [],
  warnings: [],
};

const COLD = {
  cached: false as const,
  window: {
    start: '2026-08-30T00:00:00.000Z',
    end: '2026-09-29T00:00:00.000Z',
    key: '30d',
  },
  scope: { type: 'projects' as const, projectPaths: ['acme/web-app'] },
};

const skeleton = () =>
  screen.queryByRole('region', { name: 'Loading standings' });

function idleRefreshJob(
  overrides: Partial<ReturnType<typeof useRefreshJob>> = {}
) {
  return {
    jobId: null,
    refreshing: false,
    progress: null,
    start: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

// Regression coverage for the cold-cache orchestration bug: a cache-only probe that comes back
// cold (no cached data for this selection, e.g. trend just turned on with no prior-window cache)
// used to leave the leaderboard blank -- zero rows, no loading text -- for the whole background
// refresh, because the loading state was gated on the probe's own isFetching flag, which
// turns false the instant the probe settles, well before the refresh job it kicks off finishes.
describe('App: cold-cache orchestration', () => {
  it('shows a loading indicator, not a blank leaderboard, the instant a cold cache starts a background refresh', () => {
    useLeaderboard.mockReturnValue({
      data: COLD,
      error: null,
      isFetching: false,
    });
    const start = vi.fn();
    useRefreshJob.mockReturnValue(idleRefreshJob({ start }));

    renderWithProviders(<App />);

    expect(skeleton()).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(start).toHaveBeenCalled();
  });

  it('clears the loading indicator when a running refresh is cancelled, rather than stranding it', async () => {
    const user = userEvent.setup();
    useLeaderboard.mockReturnValue({
      data: COLD,
      error: null,
      isFetching: false,
    });
    const cancel = vi.fn();
    useRefreshJob.mockReturnValue(
      idleRefreshJob({ jobId: 'job-1', refreshing: true, cancel })
    );

    renderWithProviders(<App />);
    expect(skeleton()).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: /cancel/i,
      })
    );

    // cancel() never routes through onDone or onError, so if the handler does not clear the
    // flag itself the indicator stays up forever with nothing running behind it.
    expect(cancel).toHaveBeenCalled();
    expect(skeleton()).not.toBeInTheDocument();
  });

  it('keeps the loading indicator up once the refresh job is actually running (jobId assigned)', () => {
    useLeaderboard.mockReturnValue({
      data: COLD,
      error: null,
      isFetching: false,
    });
    useRefreshJob.mockReturnValue(
      idleRefreshJob({ jobId: 'job-1', refreshing: true })
    );

    renderWithProviders(<App />);

    expect(skeleton()).toBeInTheDocument();
    expect(screen.getByText('Building Aug 30 – Sep 29')).toBeInTheDocument();
    expect(
      screen.getByText('Aug 30 – Sep 29 · first refresh for this window', {
        normalizer: t => t.replace(/\s+/g, ' ').trim(),
      })
    ).toBeInTheDocument();
    expect(screen.getByText('acme/web-app')).toBeInTheDocument();
  });

  it('renders the leaderboard, with no loading text, once warm-cache data is available', () => {
    useLeaderboard.mockReturnValue({
      data: { ...EMPTY, cached: true },
      error: null,
      isFetching: false,
    });
    useRefreshJob.mockReturnValue(idleRefreshJob());

    renderWithProviders(<App />);

    expect(skeleton()).not.toBeInTheDocument();
    expect(
      screen.getByText('No users configured, or none resolved on the instance.')
    ).toBeInTheDocument();
  });

  it('does not show a loading indicator before any probe result has arrived and nothing is refreshing', () => {
    useLeaderboard.mockReturnValue({
      data: undefined,
      error: null,
      isFetching: false,
    });
    useRefreshJob.mockReturnValue(idleRefreshJob());

    renderWithProviders(<App />);

    expect(skeleton()).not.toBeInTheDocument();
  });

  it('keeps the last good numbers on screen, dimmed, under a warm refresh', () => {
    useLeaderboard.mockReturnValue({
      data: { ...EMPTY, cached: true },
      error: null,
      isFetching: false,
    });
    useRefreshJob.mockReturnValue(
      idleRefreshJob({ jobId: 'job-1', refreshing: true })
    );

    const { container } = renderWithProviders(<App />);

    expect(
      screen.getByText('Showing the last good numbers until this finishes')
    ).toBeInTheDocument();
    expect(skeleton()).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-parity="Standings"]')?.className
    ).toMatch(/dimmed/);
    expect(
      container.querySelector('[data-parity="Fresh Label"]')?.textContent
    ).toBe('Refreshing · 0s');
    expect(
      container.querySelector('[data-parity="Leaderboard · Refreshing"]')
    ).not.toBeNull();
  });
});

describe('App: refresh on the person page', () => {
  it('refetches the evidence for the regenerated standings once a refresh finishes', async () => {
    useAppRoute.mockReturnValue({
      name: 'stat',
      username: 'srivera',
      stat: 'issuesCompleted',
    });
    const before = fixtureLeaderboard(false);
    const after = { ...before, generatedAt: '2026-08-31T12:05:00.000Z' };
    useLeaderboard.mockReturnValue({
      data: before,
      error: null,
      isFetching: false,
    });
    useUserDetail.mockImplementation(
      (username: string, _selection: unknown, generatedAt: string) => {
        const detail = fixtureDetail(username, false)!;
        if (generatedAt !== after.generatedAt) {
          return { data: detail, error: null, isLoading: false };
        }
        const issues = detail.evidence.issuesCompleted!;
        return {
          data: {
            ...detail,
            evidence: {
              ...detail.evidence,
              issuesCompleted: { ...issues, rows: issues.rows.slice(0, 2) },
            },
          },
          error: null,
          isLoading: false,
        };
      }
    );
    useRefreshJob.mockReturnValue(idleRefreshJob());

    const { container } = renderWithProviders(<App />);
    const rows = () =>
      container.querySelectorAll(
        '[data-parity="Panel · Issues done"] [data-parity^="Ev Row "]'
      );
    await waitFor(() => expect(rows()).toHaveLength(9));

    const { onDone } = useRefreshJob.mock.calls.at(-1)![0];
    act(() => onDone(after, { range: '30d', trend: false }));

    expect(useUserDetail).toHaveBeenLastCalledWith(
      'srivera',
      expect.anything(),
      after.generatedAt
    );
    expect(rows()).toHaveLength(2);
  });
});
