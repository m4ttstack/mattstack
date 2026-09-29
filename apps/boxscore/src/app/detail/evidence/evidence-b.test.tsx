import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import {
  fixtureDetail,
  fixtureLeaderboard,
} from '../../../server/fixture/index';
import type { MetricEvidence, MetricKey } from '../../../shared/types';
import { App } from '../../App';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock('../../hooks/useLeaderboard', () => ({
  useLeaderboard,
  useUserDetail,
}));

beforeEach(() => {
  useLeaderboard.mockReturnValue({
    data: fixtureLeaderboard(false),
    error: null,
    isFetching: false,
  });
  useUserDetail.mockImplementation((username: string) => ({
    data: fixtureDetail(username, false),
    error: null,
    isLoading: false,
  }));
  // Recharts draws nothing into a zero-sized container, and jsdom lays nothing out.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 958,
    bottom: 154,
    width: 958,
    height: 154,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function panelAt(stat: string) {
  const location = memoryLocation({ path: `/user/srivera/${stat}` });
  const { container } = renderWithProviders(
    <Router hook={location.hook}>
      <App />
    </Router>
  );
  const panel = container.querySelector<HTMLElement>(
    '[data-parity^="Panel · "]'
  )!;
  await waitFor(() => expect(within(panel).queryByText('Loading…')).toBeNull());
  return panel;
}

function withEvidence(stat: MetricKey, edit: (ev: MetricEvidence) => void) {
  useUserDetail.mockImplementation((username: string) => {
    const data = fixtureDetail(username, false)!;
    const ev = structuredClone(data.evidence[stat]!);
    edit(ev);
    data.evidence = { ...data.evidence, [stat]: ev };
    return { data, error: null, isLoading: false };
  });
}

const layers = (root: ParentNode, name: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-parity="${name}"]`),
];
const layer = (root: ParentNode, name: string) => layers(root, name)[0];
const rowsOf = (root: ParentNode, prefix: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-parity^="${prefix} "]`),
];
const texts = (nodes: HTMLElement[]) => nodes.map(n => n.textContent);

describe('MRs merged panel', () => {
  it('lists the newest six with a diff bar and a footer', async () => {
    const panel = await panelAt('mrsMerged');
    expect(panel).toHaveAttribute('data-parity', 'Panel · MRs merged');
    expect(layer(panel, 'Sort Newest')).toHaveStyle({
      background: 'var(--tk-raised)',
    });
    const rows = rowsOf(panel, 'MR');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveAttribute('data-parity', 'MR !16169');
    expect(layer(rows[0]!, 'a')).toHaveTextContent('+60');
    expect(layer(rows[0]!, 'd')).toHaveTextContent('−2');
    expect(layer(rows[0]!, 'dt')).toHaveTextContent('Sep 28');
    const blocks = layers(
      rows.find(r => r.dataset.parity === 'MR !15843')!,
      'b'
    );
    expect(blocks.map(b => b.style.background)).toEqual([
      'var(--tk-fill-ok)',
      'var(--tk-fill-ok)',
      'var(--tk-fill-ok)',
      'var(--tk-fill-ok)',
      'var(--tk-fill-bad)',
    ]);
    expect(layer(panel, 'c')).toHaveTextContent('Showing 6 of 47');
  });

  it('opens with Most added active from the additions stat', async () => {
    const panel = await panelAt('additions');
    expect(layer(panel, 'Sort Most added')).toHaveStyle({
      background: 'var(--tk-raised)',
    });
    expect(layer(panel, 'Sort Newest')).toBeUndefined();
    expect(rowsOf(panel, 'MR')[0]).toHaveAttribute('data-parity', 'MR !15612');
  });

  it('opens with Most deleted active from the deletions stat', async () => {
    const user = userEvent.setup();
    const panel = await panelAt('deletions');
    expect(
      within(panel).getByRole('tab', { name: 'Most deleted' })
    ).toHaveAttribute('aria-selected', 'true');
    expect(rowsOf(panel, 'MR')[0]).toHaveAttribute('data-parity', 'MR !15827');
    await user.click(within(panel).getByRole('tab', { name: 'Newest' }));
    expect(rowsOf(panel, 'MR')[0]).toHaveAttribute('data-parity', 'MR !16169');
  });
});

describe('Size health panel', () => {
  it('bins the merged MRs and colours the healthy band', async () => {
    const panel = await panelAt('sizeHealthPct');
    expect(texts(layers(panel, 'cnt'))).toEqual([
      '0',
      '3',
      '4',
      '8',
      '15',
      '11',
      '6',
    ]);
    const inBand = rowsOf(panel, 'Bin').filter(b =>
      ['Bin 10–50', 'Bin 50–100', 'Bin 100–200', 'Bin 200–400'].includes(
        b.dataset.parity!
      )
    );
    expect(inBand).toHaveLength(4);
    expect(inBand.map(b => layer(b, 'cnt')!.textContent)).toEqual([
      '3',
      '4',
      '8',
      '15',
    ]);
    expect(inBand[0]).toHaveStyle({
      background: 'var(--mantine-color-ok-light)',
    });
    expect(layer(inBand[0]!, 'bar')).toHaveStyle({
      background: 'var(--tk-fill-ok)',
    });
    expect(layers(panel, 'bar')[5]).toHaveStyle({
      background: 'var(--tk-fill-warn)',
    });
    expect(within(panel).getByText('Healthy band, 10–400 lines')).toBeVisible();
    const rows = rowsOf(panel, 'Sz');
    expect(rows.map(r => r.dataset.parity)).toEqual([
      'Sz !15843',
      'Sz !15829',
      'Sz !15827',
    ]);
    expect(layer(rows[0]!, 'c')).toHaveTextContent('604 lines');
    expect(layer(rows[0]!, 'c')).toHaveStyle({ color: 'var(--tk-text-warn)' });
    expect(layer(panel, 'Ev Footer')).toHaveTextContent(
      'Showing 3 of 17 outside the band'
    );
  });
});

describe('Revert rate panel', () => {
  it('shows the zero state and a dimmed example row', async () => {
    const panel = await panelAt('revertRate');
    expect(layer(panel, 'zt')).toHaveTextContent(
      'No reverts across 47 merged MRs'
    );
    expect(layer(panel, 'Revert Example')).toBeDefined();
    expect(layer(panel, 'c')).toHaveTextContent('47 merged MRs checked');
  });

  it('lists reverted MRs with who reverted them and when', async () => {
    withEvidence('revertRate', ev => {
      ev.facts = { ...ev.facts, reverted: 1 };
      const row = ev.rows[3]!;
      row.cells = [...row.cells.slice(0, 3), '!16200', '2d'];
      row.muted = false;
    });
    const panel = await panelAt('revertRate');
    expect(layer(panel, 'Zero State')).toBeUndefined();
    expect(layer(panel, 'Revert Example')).toBeUndefined();
    const rows = rowsOf(panel, 'Revert');
    expect(rows.map(r => r.dataset.parity)).toEqual(['Revert !15844']);
    expect(layer(rows[0]!, 'b')).toHaveTextContent(
      'reverted by !16200 after 2d'
    );
    expect(layer(rows[0]!, 'Rev Badge')).toHaveStyle({
      background: 'var(--mantine-color-bad-light)',
    });
  });
});

describe('MRs reviewed panel', () => {
  it('splits reviews by author and lists the newest five', async () => {
    const panel = await panelAt('mrsReviewed');
    const authors = [...panel.querySelectorAll<HTMLElement>('[data-author]')];
    expect(authors.map(a => a.dataset.author)).toEqual([
      'nvance',
      'pnair',
      'kmorgan',
      'tberg',
      'lortiz',
      'radeyemi',
    ]);
    expect(texts(authors.map(a => layer(a, 'l')!))).toEqual([
      '@nvance · 46',
      '@pnair · 11',
      '@kmorgan · 6',
      '5',
      '4',
      '2',
    ]);
    const rows = rowsOf(panel, 'Rw');
    expect(rows.slice(1).map(r => r.dataset.parity)).toEqual([
      'Rw !16185',
      'Rw !16144',
      'Rw !16096',
      'Rw !16095',
      'Rw !16093',
    ]);
    expect(layer(rows[1]!, 'a')).toHaveTextContent('@tberg');
    expect(layer(rows[3]!, 'i')).toHaveStyle({ color: 'var(--tk-text-3)' });
    expect(layer(layer(panel, 'Ev Footer')!, 'c')).toHaveTextContent(
      'Showing 5 of 74'
    );
  });
});

describe('Review depth panel', () => {
  it('bins comments per MR and lists the deepest reviews', async () => {
    const panel = await panelAt('reviewDepth');
    expect(texts(layers(panel, 'cnt'))).toEqual(['30', '13', '10', '16', '5']);
    const bars = layers(panel, 'bar');
    expect(bars[0]).toHaveStyle({ background: 'var(--tk-muted)' });
    expect(bars[1]).toHaveStyle({ background: 'var(--tk-fill-accent)' });
    expect(texts(layers(panel, 'l'))).toEqual([
      '0 comments',
      '1 comment',
      '2 comments',
      '3–5 comments',
      '6 + comments',
    ]);
    const rows = rowsOf(panel, 'Dp');
    expect(rows).toHaveLength(3);
    expect(layer(rows[0]!, 'n')).toHaveTextContent('10');
    expect(layers(rows[0]!, 'p')).toHaveLength(10);
  });
});

describe('Merge streak panel', () => {
  it('marks the longest run gold and the current streak accent', async () => {
    const panel = await panelAt('longestStreak');
    const bars = layers(panel, 'bar');
    expect(bars).toHaveLength(30);
    const days = [...panel.querySelectorAll<HTMLElement>('[data-day]')].map(
      d => d.dataset.day
    );
    const at = (d: string) => bars[days.indexOf(d)]!;
    for (const d of ['D 9-21', 'D 9-22', 'D 9-23', 'D 9-24', 'D 9-25'])
      expect(at(d)).toHaveStyle({ background: 'var(--tk-fill-gold)' });
    expect(at('D 9-28')).toHaveStyle({ background: 'var(--tk-fill-accent)' });
    expect(at('D 9-17')).toHaveStyle({ background: 'var(--tk-muted)' });
    expect(at('D 9-26')).toHaveStyle({ background: 'var(--tk-raised)' });
    expect(texts(layers(panel, 'a'))).toEqual([
      'Aug 30',
      'Sep 6',
      'Sep 13',
      'Sep 20',
      'Sep 28',
    ]);
    expect(within(panel).getByText('Longest run, Sep 21 – 25')).toBeVisible();
    expect(within(panel).getByText('Current streak, Sep 28')).toBeVisible();
    expect(layer(panel, 'c')).toHaveTextContent('18 merge days in the window');
  });
});

describe('empty evidence', () => {
  it.each([
    ['mrsMerged'],
    ['sizeHealthPct'],
    ['revertRate'],
    ['mrsReviewed'],
    ['reviewDepth'],
    ['longestStreak'],
  ] as [MetricKey][])('%s says nothing is in the window', async stat => {
    withEvidence(stat, ev => (ev.rows = []));
    const panel = await panelAt(stat);
    expect(within(panel).getByText('Nothing in this window')).toBeVisible();
    expect(panel.querySelector('[data-parity="Ev Footer"]')).toBeNull();
  });
});
