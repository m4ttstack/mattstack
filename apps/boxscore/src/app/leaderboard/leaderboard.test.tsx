import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureLeaderboard } from '../../server/fixture/index';
import { GROUP_ORDER, GROUPS } from '../../shared/metrics';
import { OVERVIEW, statsInGroup } from '../model/groups';
import { descriptor } from '../model/standings';
import { LeaderboardPage, leaderboardSubtitle } from './LeaderboardPage';
import { statHref } from './StandingsTable';

function renderPage(onSelectStat = vi.fn()) {
  const data = fixtureLeaderboard(false);
  renderWithProviders(
    <LeaderboardPage
      data={data}
      view="table"
      trend={false}
      sort="mrsMerged"
      onSort={vi.fn()}
      onSelectStat={onSelectStat}
    />
  );
  return { data, onSelectStat };
}

const headerLabels = () =>
  screen
    .getAllByRole('columnheader')
    .map(h => h.textContent ?? '')
    .filter(t => t !== '#' && t !== 'Person');

describe('LeaderboardPage (table)', () => {
  it('shows one leader tile per group, in group order, with the canvas leaders', () => {
    const { container } = renderWithProviders(
      <LeaderboardPage
        data={fixtureLeaderboard(false)}
        view="table"
        trend={false}
        sort="mrsMerged"
        onSort={vi.fn()}
        onSelectStat={vi.fn()}
      />
    );
    const tiles = [...container.querySelectorAll('[data-leader-group]')];
    expect(tiles.map(t => t.getAttribute('data-leader-group'))).toEqual(
      GROUP_ORDER
    );
    expect(
      tiles.map(
        t => t.querySelector('[data-parity="Leader Name"]')?.textContent
      )
    ).toEqual([
      'Nora Vance',
      'Nora Vance',
      'Tomas Berg',
      'Nora Vance',
      'Priya Nair',
    ]);
  });

  it('labels the Overview columns with the OVERVIEW stats', () => {
    renderPage();
    expect(headerLabels()).toEqual(
      OVERVIEW.map(k => (k === 'lines' ? 'Lines ±' : descriptor(k).label))
    );
  });

  it('badges the current user row with you', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Sam Rivera/ });
    expect(within(row).getByText('you')).toBeInTheDocument();
  });

  it('opens the stat a clicked cell belongs to', async () => {
    const user = userEvent.setup();
    const { onSelectStat } = renderPage();
    const row = screen.getByRole('row', { name: /Sam Rivera/ });
    await user.click(within(row).getByText('47'));
    expect(onSelectStat).toHaveBeenCalledWith('srivera', 'mrsMerged');
    expect(statHref('srivera', 'mrsMerged')).toBe('/user/srivera/mrsMerged');
  });

  it('shows the six Quality stats on the Quality tab, with no leader mark on the fully tied Revert rate', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <LeaderboardPage
        data={fixtureLeaderboard(false)}
        view="table"
        trend={false}
        sort="mrsMerged"
        onSort={vi.fn()}
        onSelectStat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('tab', { name: GROUPS.quality.label }));
    const quality = statsInGroup('quality');
    expect(quality).toHaveLength(6);
    expect(headerLabels()).toEqual(quality.map(k => descriptor(k).label));
    const revertCells = container.querySelectorAll('[data-stat="revertRate"]');
    expect(revertCells).toHaveLength(7);
    for (const cell of revertCells) {
      expect(cell.querySelector('[data-parity="Rank Pill"]')).toBeNull();
    }
  });

  it('reads the window from UTC dates in the subtitle', () => {
    expect(leaderboardSubtitle(fixtureLeaderboard(false), 'mrsMerged')).toBe(
      'Aug 30 – Sep 29  ·  7 people  ·  sorted by MRs merged'
    );
  });
});
