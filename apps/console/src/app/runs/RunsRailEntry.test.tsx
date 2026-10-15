import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { describe, expect, it, vi } from 'vitest';

const NOW = new Date(2026, 9, 15, 15, 0).getTime();

const state = vi.hoisted(() => ({
  runs: [] as RunSummary[],
  gates: [] as GateRow[],
}));

vi.mock('./useRuns', () => ({
  useRunList: () => ({ data: { runs: state.runs, asOf: NOW } }),
}));
vi.mock('./runs-page/useLinkedGates', () => ({
  useLinkedGates: () => ({ all: state.gates, byRun: new Map(), loaded: true }),
}));

const { RunsRailEntry } = await import('./RunsRailEntry');

const run = (id: string) => ({ id, status: 'running' }) as RunSummary;
const gate = (id: string, runId: string) =>
  ({
    id,
    subject: `run:${runId}`,
    kind: 'plan',
    status: 'open',
    owner: 'human',
    openedAt: NOW - 60_000,
    origin: null,
  }) as unknown as GateRow;

describe('RunsRailEntry', () => {
  it('counts a gate waiting on a listed run', () => {
    state.runs = [run('a')];
    state.gates = [gate('g1', 'a')];
    const { getByTestId } = renderWithProviders(<RunsRailEntry active />);
    expect(getByTestId('waiting-badge')).toHaveTextContent('1');
  });

  it('leaves out a gate whose run is not listed, as the tab badge does', () => {
    state.runs = [run('a')];
    state.gates = [gate('stray', 'test-validate')];
    const { queryByTestId } = renderWithProviders(<RunsRailEntry active />);
    expect(queryByTestId('waiting-badge')).toBeNull();
  });
});
