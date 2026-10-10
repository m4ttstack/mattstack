import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  RunDetail as RunDetailData,
  RunSummary,
} from '@mattstack/rt-client';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import './icons';

const runsGet = vi.fn();
const detailGet = vi.fn();
const artifactGet = vi.fn();
const gatesGet = vi.fn();

vi.mock('./api', () => ({
  client: {
    api: {
      runs: {
        $get: (...args: unknown[]) => runsGet(...args),
        ':repo': {
          ':runId': {
            $get: (...args: unknown[]) => detailGet(...args),
            artifact: { $get: (...args: unknown[]) => artifactGet(...args) },
          },
        },
      },
      gates: { $get: (...args: unknown[]) => gatesGet(...args) },
    },
  },
}));

const { App } = await import('./App');

const run = (): RunSummary => ({
  id: 'run-1',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'failed',
  current_stage: 'implement',
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 20,
  ticket: 'RT-1',
  branch: 'feat/x',
});

const DETAIL: RunDetailData = {
  run: run(),
  stages: [],
  fields: [
    { key: 'ticket', value: 'RT-1', produced_by: 'provision', at: 1 },
    { key: 'branch', value: 'feat/x', produced_by: 'provision', at: 2 },
  ],
  decisions: [],
  schemaAhead: false,
};

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('App shell', () => {
  it('puts the mark in the rail and the scheme control at its foot, with no app launcher', async () => {
    window.history.pushState(null, '', '/runs/repo-tools/run-1');
    runsGet.mockResolvedValue(ok({ runs: [run()] }));
    detailGet.mockResolvedValue(ok(DETAIL));
    artifactGet.mockResolvedValue(ok({ lines: [], truncated: false }));
    gatesGet.mockResolvedValue(ok({ gates: [] }));

    renderWithProviders(<App />);
    await screen.findByTestId('record-header');

    // The mattstack viewer owns app switching, and the mark tops the rail,
    // so the top bar names no app.
    expect(
      within(screen.getByRole('banner')).queryByText('console', {
        exact: true,
      })
    ).toBeNull();
    expect(screen.getByLabelText('Color scheme: System')).toBeInTheDocument();
    expect(screen.queryByLabelText('Apps')).not.toBeInTheDocument();
  });
});

describe('App routes', () => {
  it('sends an old /config/<key> link to that key’s row on /settings', async () => {
    window.history.pushState(null, '', '/config/board.agent.model');
    gatesGet.mockResolvedValue(ok({ gates: [] }));

    renderWithProviders(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
    expect(new URLSearchParams(window.location.search).get('explain')).toBe(
      'board.agent.model'
    );
  });
});

describe('App bar', () => {
  it('carries no page breadcrumb; the page name is the tab title', async () => {
    window.history.pushState(null, '', '/search');
    gatesGet.mockResolvedValue(ok({ gates: [] }));
    runsGet.mockResolvedValue(ok({ runs: [] }));

    renderWithProviders(<App />);

    await waitFor(() => expect(document.title).toBe('Search · console'));
    expect(screen.queryByTestId('app-bar-page')).toBeNull();
  });
});
