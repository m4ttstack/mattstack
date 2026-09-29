import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureLeaderboard } from '../../server/fixture/index';
import { GROUP_ORDER } from '../../shared/metrics';
import { statsInGroup } from '../model/groups';
import { CardsGrid } from './CardsGrid';
import { LeaderboardPage, leaderboardSubtitle } from './LeaderboardPage';

function renderCards(trend = false, onSelectStat = vi.fn()) {
  const data = fixtureLeaderboard(trend);
  const view = renderWithProviders(
    <CardsGrid
      data={data}
      prior={trend ? data.priorWindow : null}
      onSelectStat={onSelectStat}
    />
  );
  return { ...view, data, onSelectStat };
}

const card = (container: HTMLElement, stat: string) =>
  container.querySelector<HTMLElement>(`[data-stat-card="${stat}"]`)!;

const whoNames = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-parity="Who"]')].map(n => n.textContent);

const vals = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-parity="Val"]')].map(n => n.textContent);

describe('CardsGrid', () => {
  it('draws one card per stat, in metric order within group order', () => {
    const { container } = renderCards();
    const cards = [...container.querySelectorAll('[data-stat-card]')];
    expect(cards).toHaveLength(16);
    expect(cards.map(c => c.getAttribute('data-stat-card'))).toEqual(
      GROUP_ORDER.flatMap(statsInGroup)
    );
    expect(cards[0]).toHaveAttribute('data-parity', 'Card Issues done');
  });

  it('shows the tied state on Revert rate and Reverted', () => {
    const { container } = renderCards();
    for (const [stat, value] of [
      ['revertRate', '0%'],
      ['revertedCount', '0'],
    ] as const) {
      const c = card(container, stat);
      expect(within(c).getByText(value)).toHaveAttribute(
        'data-parity',
        'Tied Value'
      );
      expect(
        within(c).getByText('All 7 tied, no separation this window')
      ).toHaveAttribute('data-parity', 'Tied Note');
      expect(c.querySelector('[data-parity="Who"]')).toBeNull();
    }
  });

  it('lists people with no value last, with a dash', () => {
    const { container } = renderCards();
    const c = card(container, 'responseLatencyHours');
    expect(whoNames(c).slice(-2)).toEqual(['Lena O.', 'Ruth A.']);
    expect(vals(c).slice(-2)).toEqual(['—', '—']);
    expect(vals(c)[0]).toBe('0.66h');
  });

  it('formats values as the board does', () => {
    const { container } = renderCards();
    expect(vals(card(container, 'additions'))[0]).toBe('25,535');
    expect(vals(card(container, 'reviewDepth'))[0]).toBe('3.38/MR');
    expect(vals(card(container, 'currentStreak'))[0]).toBe('3d');
    expect(vals(card(container, 'reciprocity'))[0]).toBe('11.40');
    expect(vals(card(container, 'sizeHealthPct'))[0]).toBe('73%');
  });

  it('marks you on your row with the full name as the row layer', () => {
    const { container } = renderCards();
    const row = card(container, 'mrsMerged').querySelector(
      '[data-parity="Rank Row Sam Rivera"]'
    );
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('Sam R.')).toBeInTheDocument();
  });

  it('opens the person on that stat from a row name', async () => {
    const user = userEvent.setup();
    const data = fixtureLeaderboard(false);
    const { hook } = memoryLocation({ path: '/' });
    function Where() {
      const [loc] = useLocation();
      return <output aria-label="location">{loc}</output>;
    }
    renderWithProviders(
      <Router hook={hook}>
        <CardsGrid data={data} prior={null} onSelectStat={vi.fn()} />
        <Where />
      </Router>
    );
    const merged = document.querySelector<HTMLElement>(
      '[data-stat-card="mrsMerged"]'
    )!;
    await user.click(within(merged).getByRole('link', { name: 'Sam R.' }));
    expect(screen.getByLabelText('location')).toHaveTextContent(
      '/user/srivera/mrsMerged'
    );
  });

  it('opens the stat from a click anywhere on a row', async () => {
    const user = userEvent.setup();
    const { container, onSelectStat } = renderCards();
    await user.click(within(card(container, 'mrsMerged')).getByText('47'));
    expect(onSelectStat).toHaveBeenCalledWith('srivera', 'mrsMerged');
  });

  it('adds a delta beside each value in trend mode only', () => {
    const data = fixtureLeaderboard(true);
    const plain = renderWithProviders(
      <CardsGrid data={data} prior={null} onSelectStat={vi.fn()} />
    );
    expect(plain.container.querySelector('[data-parity="Delta"]')).toBeNull();
    plain.unmount();
    const { container } = renderCards(true);
    const row = card(container, 'issuesCompleted').querySelector<HTMLElement>(
      '[data-parity="Rank Row Sam Rivera"]'
    )!;
    const delta = row.querySelector('[data-parity="Delta"]');
    expect(delta).toHaveTextContent('▲4');
    expect(delta).toHaveStyle({ color: 'var(--tk-text-ok)' });
  });

  it('is what the cards view mounts, with no leaders strip', () => {
    const { container } = renderWithProviders(
      <LeaderboardPage
        data={fixtureLeaderboard(false)}
        view="cards"
        trend={false}
        sort="mrsMerged"
        onSort={vi.fn()}
        onSelectStat={vi.fn()}
      />
    );
    expect(container.querySelectorAll('[data-stat-card]')).toHaveLength(16);
    expect(container.querySelector('[data-leader-group]')).toBeNull();
  });

  it('subtitles the cards view as every stat, ranked', () => {
    expect(
      leaderboardSubtitle(
        fixtureLeaderboard(false),
        'mrsMerged',
        false,
        'cards'
      )
    ).toBe('Aug 30 – Sep 29  ·  7 people  ·  every stat, ranked');
  });
});
