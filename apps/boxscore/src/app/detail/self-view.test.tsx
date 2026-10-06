import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureDetail, fixtureLeaderboard } from '../../server/fixture/index';
import { App } from '../App';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock('../hooks/useLeaderboard', () => ({ useLeaderboard, useUserDetail }));

beforeEach(() => {
  process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
  useLeaderboard.mockReturnValue({
    data: fixtureLeaderboard(false),
    error: null,
    isFetching: false,
  });
  useUserDetail.mockImplementation((username: string) => {
    const d = fixtureDetail(username, false);
    return d && d !== 'forbidden'
      ? { data: d, error: null, isLoading: false }
      : { data: undefined, error: new Error('forbidden'), isLoading: false };
  });
});
afterEach(() => {
  delete process.env.BOXSCORE_FIXTURE_SCENARIO;
});

const layer = (root: ParentNode, name: string) =>
  root.querySelector<HTMLElement>(`[data-parity="${name}"]`);

function renderAt(path: string) {
  const location = memoryLocation({ path, record: true });
  return renderWithProviders(
    <Router hook={location.hook}>
      <App />
    </Router>
  );
}

describe('person page in Self view', () => {
  it('drops navigation and every ranking, keeping the values', async () => {
    const { container } = renderAt('/user/srivera/issuesCompleted');
    await waitFor(() =>
      expect(layer(container, 'Profile Header')).not.toBeNull()
    );
    expect(layer(container, 'Back Link')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /choose a person/i })
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Previous person' })).toBeNull();
    expect(layer(container, 'Summary')).toBeNull();
    expect(layer(container, 'Sum Coding days')).toBeNull();
    expect(layer(container, 'Sum Leads')).toBeNull();
    expect(layer(container, 'Sum Top 3')).toBeNull();
    expect(layer(container, 'Sum Median rank')).toBeNull();
    expect(screen.getByText('Coding days')).toBeInTheDocument();
    const rail = layer(container, 'Stat Rail')!;
    expect(within(rail).queryAllByText(/^#\d+$|^–$/)).toHaveLength(0);
    expect(layer(container, 'Rank Block')).toBeNull();
    expect(layer(container, 'Leader Block')).toBeNull();
    expect(layer(container, 'Field')).toBeNull();
    expect(layer(container, 'Big Value')).not.toBeNull();
  });

  it("shows the page even when the viewer's identity is unresolved", async () => {
    const board = fixtureLeaderboard(false);
    board.users[0] = { ...board.users[0]!, resolved: false };
    useLeaderboard.mockReturnValue({
      data: board,
      error: null,
      isFetching: false,
    });
    const { container } = renderAt('/user/srivera');
    await waitFor(() =>
      expect(layer(container, 'Profile Header')).not.toBeNull()
    );
  });
});
