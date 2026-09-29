import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureLeaderboard } from '../../server/fixture/index';
import { GROUP_ORDER, GROUPS } from '../../shared/metrics';
import { OVERVIEW, statsInGroup } from '../model/groups';
import { descriptor } from '../model/standings';
import rowHover from '../ui/row-hover.module.css';
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

  it('gives every standings row the CSS row highlight, and marks yours', () => {
    renderPage();
    const nora = screen.getByRole('row', { name: /Nora Vance/ });
    const sam = screen.getByRole('row', { name: /Sam Rivera/ });
    expect(nora).toHaveClass(rowHover.row!);
    expect(nora).not.toHaveAttribute('data-you');
    expect(sam).toHaveClass(rowHover.row!);
    expect(sam).toHaveAttribute('data-you');
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
    expect(
      leaderboardSubtitle(fixtureLeaderboard(false), 'mrsMerged', false)
    ).toBe('Aug 30 – Sep 29  ·  7 people  ·  sorted by MRs merged');
  });
});

describe('LeaderboardPage (trend)', () => {
  function renderTrend() {
    return renderWithProviders(
      <LeaderboardPage
        data={fixtureLeaderboard(true)}
        view="table"
        trend
        sort="mrsMerged"
        onSort={vi.fn()}
        onSelectStat={vi.fn()}
      />
    );
  }

  const deltaIn = (username: string, stat: string) => {
    const row = screen.getByRole('row', { name: new RegExp(`@${username}`) });
    const cell = row.querySelector(`[data-stat="${stat}"]`)!;
    return cell.querySelector<HTMLElement>('[data-parity="Delta"]');
  };

  it('appends a toned delta after each value and none for a zero delta', () => {
    renderTrend();
    const issues = deltaIn('srivera', 'issuesCompleted')!;
    expect(issues).toHaveTextContent('▲4');
    expect(issues.style.color).toBe('var(--tk-text-ok)');
    const wait = deltaIn('nvance', 'reviewLatencyHours')!;
    expect(wait).toHaveTextContent('▲0.2h');
    expect(wait.style.color).toBe('var(--tk-text-bad)');
    expect(deltaIn('srivera', 'reviewDepth')).toBeNull();
  });

  it('shows no delta marks in values mode', () => {
    renderWithProviders(
      <LeaderboardPage
        data={fixtureLeaderboard(true)}
        view="table"
        trend={false}
        sort="mrsMerged"
        onSort={vi.fn()}
        onSelectStat={vi.fn()}
      />
    );
    expect(document.querySelector('[data-parity="Delta"]')).toBeNull();
  });

  it("appends the current user's delta to each leader tile's You row", () => {
    const { container } = renderTrend();
    const youDelta = (group: string) =>
      container
        .querySelector(`[data-leader-group="${group}"]`)!
        .querySelector('[data-parity="Delta"]');
    expect(youDelta('delivery')).toHaveTextContent('▲4');
    expect(youDelta('collaboration')).toHaveTextContent('▼1.1');
    expect(youDelta('consistency')).toBeNull();
  });

  it('adds the better and worse legend naming the prior window', () => {
    renderTrend();
    expect(screen.getByText('better')).toBeInTheDocument();
    expect(screen.getByText('worse than Jul 31 – Aug 29')).toBeInTheDocument();
  });

  it('names the prior window in the subtitle, ending the day before the current window starts', () => {
    expect(
      leaderboardSubtitle(fixtureLeaderboard(true), 'mrsMerged', true)
    ).toBe(
      'Aug 30 – Sep 29 vs Jul 31 – Aug 29  ·  7 people  ·  sorted by MRs merged'
    );
  });
});

function Where() {
  const [location] = useLocation();
  return <output aria-label="location">{location}</output>;
}

describe('StandingsTable keyboard access', () => {
  it('opens a person from the keyboard: their name links to the sorted stat', async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: '/' });
    renderWithProviders(
      <Router hook={hook}>
        <LeaderboardPage
          data={fixtureLeaderboard(false)}
          view="table"
          trend={false}
          sort="mrsMerged"
          onSort={vi.fn()}
          onSelectStat={vi.fn()}
        />
        <Where />
      </Router>
    );
    const link = screen.getByRole('link', { name: 'Sam Rivera' });
    link.focus();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('location')).toHaveTextContent(
      '/user/srivera/mrsMerged'
    );
  });

  it('sorts from a real button inside each stat header', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderWithProviders(
      <LeaderboardPage
        data={fixtureLeaderboard(false)}
        view="table"
        trend={false}
        sort="mrsMerged"
        onSort={onSort}
        onSelectStat={vi.fn()}
      />
    );
    const header = screen
      .getAllByRole('columnheader')
      .find(h => h.textContent === 'Issues done')!;
    const button = within(header).getByRole('button', { name: 'Issues done' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(onSort).toHaveBeenCalledWith('issuesCompleted');
  });
});
