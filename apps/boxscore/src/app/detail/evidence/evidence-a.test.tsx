import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import {
  fixtureDetail,
  fixtureLeaderboard,
} from '../../../server/fixture/index';
import { App } from '../../App';
import { quietWeekdays } from './CodingDaysEvidence';

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
    bottom: 144,
    width: 958,
    height: 144,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function panelAt(stat: string, label: string) {
  const location = memoryLocation({ path: `/user/srivera/${stat}` });
  const { container } = renderWithProviders(
    <Router hook={location.hook}>
      <App />
    </Router>
  );
  return container.querySelector<HTMLElement>(
    `[data-parity="Panel · ${label}"]`
  )!;
}

const layers = (root: ParentNode, name: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-parity="${name}"]`),
];
const layer = (root: ParentNode, name: string) => layers(root, name)[0];

describe('Wait for review panel', () => {
  it('draws seven bins with the p50 bin highlighted', () => {
    const panel = panelAt('reviewLatencyHours', 'Wait for review');
    const bars = layers(panel, 'bar');
    expect(bars).toHaveLength(7);
    expect(bars[1]).toHaveStyle({ background: 'var(--tk-fill-accent)' });
    expect(bars[0]).toHaveStyle({ background: 'var(--tk-muted)' });
    expect(layers(panel, 'cnt').map(n => n.textContent)).toEqual([
      '0',
      '33',
      '8',
      '3',
      '2',
      '1',
      '3',
    ]);
    const labels = layers(panel, 'l');
    expect(labels.map(n => n.textContent)).toEqual([
      '< 0.5h',
      '0.5–1h',
      '1–2h',
      '2–4h',
      '4–8h',
      '8–24h',
      '24h +',
    ]);
    expect(labels[1]).toHaveStyle({ color: 'var(--tk-text-accent)' });
  });

  it('lists the six slowest waits, longest first, warning past a day', async () => {
    const user = userEvent.setup();
    const panel = panelAt('reviewLatencyHours', 'Wait for review');
    const rows = () => [
      ...panel.querySelectorAll('[data-parity^="Wait Row "]'),
    ];
    expect(rows().map(r => r.getAttribute('data-parity'))).toEqual([
      'Wait Row !14028',
      'Wait Row !15023',
      'Wait Row !15046',
      'Wait Row !14281',
      'Wait Row !15531',
      'Wait Row !15289',
    ]);
    const first = rows()[0]!;
    expect(layer(first, 'h')).toHaveTextContent('125.3h');
    expect(layer(first, 'h')).toHaveStyle({ color: 'var(--tk-text-warn)' });
    expect(layer(rows()[3]!, 'h')).toHaveStyle({ color: 'var(--tk-text-3)' });
    expect(layer(panel, 'c')).toHaveTextContent(
      'Showing 6 of 50 · bars on a log scale'
    );
    await user.click(
      within(panel).getByRole('button', { name: 'Show all 50' })
    );
    expect(rows()).toHaveLength(50);
  });
});

describe('Coding days panel', () => {
  it('prints the busiest day on the calendar and in the facts', () => {
    const panel = panelAt('codingDays', 'Coding days');
    expect(layer(layer(panel, 'Day 9-17')!, 'n')).toHaveTextContent('28');
    expect(layers(panel, 'fv').map(n => n.textContent)).toEqual([
      'Thu Sep 17 · 28 pushes',
      '5 days, 3 times (Aug 31 – Sep 4, Sep 14 – 18, 21 – 25)',
      'Mon Sep 7',
    ]);
    expect(layer(panel, 'a')).toHaveTextContent('Fewer');
    expect(layer(panel, 'b')).toHaveTextContent('More');
  });
});

describe('Pipelines panel', () => {
  it('reads outcome counts and shares, then the last seven days', () => {
    const panel = panelAt('pipelines', 'Pipelines');
    const legend = within(panel).getAllByRole('listitem');
    expect(legend[0]).toHaveTextContent('Success13865%');
    expect(legend[1]).toHaveTextContent('Failed6531%');
    const days = [...panel.querySelectorAll('[data-parity^="Day Sep"]')];
    expect(days.map(d => d.getAttribute('data-parity'))).toEqual([
      'Day Sep 28',
      'Day Sep 27',
      'Day Sep 25',
      'Day Sep 24',
      'Day Sep 23',
      'Day Sep 22',
      'Day Sep 21',
    ]);
    expect(layer(days[0]!, 't')).toHaveTextContent('6');
    const failed = layer(days[2]!, 't')!;
    expect(failed).toHaveTextContent('16 · 6 failed');
    expect(failed).toHaveStyle({ color: 'var(--tk-text-bad)' });
  });
});

describe('Reciprocity panel', () => {
  it('weighs reviews given against reviewers received', async () => {
    const user = userEvent.setup();
    const panel = panelAt('reciprocity', 'Reciprocity');
    const balance = (name: string) =>
      layer(within(panel).getByRole('group', { name }), 'n');
    expect(balance('Given')).toHaveTextContent('74');
    expect(balance('Received')).toHaveTextContent('9');
    const rows = () => [...panel.querySelectorAll('[data-parity^="Rev "]')];
    expect(rows()).toHaveLength(7);
    expect(layer(rows()[0]!, 'u')).toHaveTextContent('@dbrook');
    expect(layer(rows()[0]!, 'n')).toHaveTextContent('40 MRs');
    expect(layer(rows()[6]!, 'n')).toHaveTextContent('1 MR');
    await user.click(within(panel).getByRole('button', { name: 'Show all 9' }));
    expect(rows()).toHaveLength(9);
  });
});

function withEvidence(
  stat: 'codingDays' | 'reciprocity',
  edit: (ev: { rows: unknown[] }) => void
) {
  useUserDetail.mockImplementation((username: string) => {
    const data = fixtureDetail(username, false)!;
    edit(data.evidence[stat]!);
    return { data, error: null, isLoading: false };
  });
}

describe('empty evidence', () => {
  it('says so when a person pushed nothing in the window', () => {
    withEvidence('codingDays', ev => (ev.rows = []));
    const panel = panelAt('codingDays', 'Coding days');
    expect(within(panel).getByText('Nothing in this window')).toBeVisible();
    expect(layer(panel, 'fv')).toBeUndefined();
  });

  it('keeps give and take when nobody reviewed your MRs', () => {
    withEvidence('reciprocity', ev => (ev.rows = []));
    const panel = panelAt('reciprocity', 'Reciprocity');
    expect(within(panel).getByRole('group', { name: 'Given' })).toBeVisible();
    expect(within(panel).getByText('Nothing in this window')).toBeVisible();
    expect(panel.querySelector('[data-parity="Ev Footer"]')).toBeNull();
  });
});

describe('quiet weekdays', () => {
  it('names the first three and counts the rest', () => {
    const days = [
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ].map(date => ({ date, count: 0, inWindow: true, level: 0 as const }));
    expect(quietWeekdays(days)).toBe(
      'Mon Sep 7, Tue Sep 8, Wed Sep 9 and 2 more'
    );
    expect(quietWeekdays(days.slice(0, 1))).toBe('Mon Sep 7');
  });
});
