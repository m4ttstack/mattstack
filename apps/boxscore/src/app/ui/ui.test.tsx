import { readFileSync } from 'node:fs';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render } from '@mattstack/app-kit/test-utils';
import { CountChip } from './CountChip';
import { DeltaMark } from './DeltaMark';
import { GroupTag } from './GroupTag';
import { LeaderMark } from './LeaderMark';
import { PushCalendar } from './PushCalendar';
import { RankRow } from './RankRow';
import rowHover from './row-hover.module.css';
import { TeamStrip } from './TeamStrip';

const parityOf = (el: Element | null) => el?.getAttribute('data-parity');

describe('LeaderMark', () => {
  it('is a gold 16px circle holding the numeral 1', () => {
    render(<LeaderMark parity="Gold" />);
    const n = screen.getByText('1');
    expect(parityOf(n)).toBe('n');
    const mark = n.closest('[data-parity="Gold"]');
    expect(mark).toHaveStyle({ width: '16px', height: '16px' });
  });
});

describe('RankRow', () => {
  it('RankRow marks you and leader', () => {
    render(
      <RankRow
        rank={1}
        name="Nora V."
        value="77"
        fraction={1}
        leader
        parity="R"
      />
    );
    expect(screen.getByText('1').closest('[data-parity]')).toBeTruthy();
    render(<RankRow rank={2} name="Sam R." value="48" fraction={0.62} you />);
    expect(screen.getByText('Sam R.')).toHaveStyle({
      color: 'var(--tk-text-accent)',
    });
  });

  it('names its layers as the canvas does', () => {
    render(
      <RankRow
        rank={1}
        name="Nora V."
        value="77"
        fraction={1}
        leader
        parity="Rank Row Nora Vance"
      />
    );
    const row = document.querySelector('[data-parity="Rank Row Nora Vance"]')!;
    expect(parityOf(screen.getByText('1').parentElement)).toBe('Rank');
    expect(parityOf(screen.getByText('Nora V.'))).toBe('Who');
    expect(parityOf(screen.getByText('77'))).toBe('Val');
    const bar = row.querySelector('[data-parity="Track"] [data-parity="Bar"]');
    expect(bar).toBeTruthy();
  });

  it('gives a plain rank no pill and a muted name', () => {
    render(<RankRow rank={3} name="Tomas B." value="12" fraction={0.2} />);
    const n = screen.getByText('3');
    expect(parityOf(n)).toBe('n');
    expect(n.closest('[data-parity="Rank"]')).toBeNull();
    expect(screen.getByText('Tomas B.')).toHaveStyle({
      color: 'var(--tk-text-2)',
    });
  });

  it('draws an unranked row with a dash rank, no bar and a dimmed value', () => {
    const { container } = render(
      <RankRow rank={null} name="Lena O." value="—" fraction={0} dim />
    );
    expect(parityOf(screen.getByText('–'))).toBe('n');
    expect(container.querySelector('[data-parity="Bar"]')).toBeNull();
    expect(screen.getByText('—')).toHaveStyle({ color: 'var(--tk-text-3)' });
  });

  it('makes the name a link when given an href', () => {
    render(
      <RankRow
        rank={2}
        name="Sam R."
        value="47"
        fraction={0.6}
        href="/user/srivera/mrsMerged"
      />
    );
    const link = screen.getByRole('link', { name: 'Sam R.' });
    expect(link).toHaveAttribute('href', '/user/srivera/mrsMerged');
    expect(link.getAttribute('data-parity')).toBeNull();
  });

  it('appends a delta after the value', () => {
    render(
      <RankRow
        rank={2}
        name="Sam R."
        value="48"
        fraction={0.6}
        delta={{ text: '▼1', tone: 'worse' }}
      />
    );
    const delta = screen.getByText('▼1');
    expect(parityOf(delta)).toBe('Delta');
    expect(delta).toHaveStyle({ color: 'var(--tk-text-bad)' });
  });
  it('highlights the whole row from CSS on hover and on focus inside it', () => {
    render(
      <RankRow
        rank={2}
        name="Sam R."
        value="48"
        fraction={0.6}
        href="/user/srivera/mrsMerged"
        parity="Row"
      />
    );
    const row = screen.getByText('Sam R.').closest('[data-parity="Row"]')!;
    expect(row).toHaveClass(rowHover.row!);
    expect(row).not.toHaveAttribute('data-you');
    const css = readFileSync('src/app/ui/row-hover.module.css', 'utf8');
    expect(css).toMatch(/@media \(hover: hover\)\s*\{\s*\.row:hover\s*\{/);
    expect(css).toMatch(
      /@media \(hover: hover\)\s*\{\s*\.row\[data-you\]:hover\s*\{/
    );
    expect(css).toMatch(/^\.row:focus-within\s*\{/m);
    expect(css).toMatch(/^\.row\[data-you\]:focus-within\s*\{/m);
    expect(css).not.toMatch(/transition/);
  });

  it('marks your row so its accent tint survives the hover', () => {
    render(
      <RankRow
        rank={2}
        name="Sam R."
        value="48"
        fraction={0.6}
        you
        parity="Row"
      />
    );
    const row = screen.getByText('Sam R.').closest('[data-parity="Row"]')!;
    expect(row).toHaveClass(rowHover.row!);
    expect(row).toHaveAttribute('data-you');
  });
});

describe('DeltaMark', () => {
  it('DeltaMark colours by tone', () => {
    render(<DeltaMark text="▲8" tone="better" />);
    expect(screen.getByText('▲8')).toHaveStyle({ color: 'var(--tk-text-ok)' });
  });

  it('reads bad for a worse delta', () => {
    render(<DeltaMark text="▼10" tone="worse" parity="Delta" />);
    const el = screen.getByText('▼10');
    expect(el).toHaveStyle({ color: 'var(--tk-text-bad)' });
    expect(parityOf(el)).toBe('Delta');
  });
});

describe('GroupTag', () => {
  it('draws a hue swatch and an uppercase label', () => {
    render(
      <GroupTag group="delivery" variant="swatch-label" parity="Group Tag" />
    );
    const label = screen.getByText('DELIVERY');
    expect(parityOf(label)).toBe('Group');
    expect(label).toHaveStyle({ color: 'var(--tk-text-cyan)' });
    const swatch = document.querySelector('[data-parity="Swatch"]');
    expect(swatch).toHaveStyle({ background: 'var(--tk-text-cyan)' });
  });

  it('mutes the neutral group label in the swatch form', () => {
    render(<GroupTag group="volume" variant="swatch-label" />);
    expect(screen.getByText('VOLUME')).toHaveStyle({
      color: 'var(--tk-text-3)',
    });
  });

  it('fills the pill with the light hue and small text', () => {
    render(<GroupTag group="delivery" variant="pill" parity="Group Tag" />);
    const pill = document.querySelector('[data-parity="Group Tag"]');
    expect(pill).toHaveStyle({
      background: 'var(--mantine-color-cyan-light)',
    });
    expect(screen.getByText('DELIVERY')).toHaveStyle({
      color: 'var(--tk-text-cyan-small)',
    });
    expect(document.querySelector('[data-parity="Swatch"]')).toBeNull();
  });

  it('draws the neutral pill on surface step 3 with body text', () => {
    render(<GroupTag group="volume" variant="pill" parity="Group Tag" />);
    expect(document.querySelector('[data-parity="Group Tag"]')).toHaveStyle({
      background: 'var(--tk-surface-3)',
    });
    expect(screen.getByText('VOLUME')).toHaveStyle({
      color: 'var(--tk-text-2)',
    });
  });

  it('uses the tile names and 8px swatch in the tile form', () => {
    render(<GroupTag group="quality" variant="tile" parity="Group" />);
    expect(parityOf(screen.getByText('QUALITY'))).toBe('Group Label');
    expect(document.querySelector('[data-parity="Group Swatch"]')).toHaveStyle({
      width: '8px',
    });
  });
});

describe('CountChip', () => {
  it('fills with the light hue and small hue text', () => {
    render(<CountChip label="65 failed" tone="bad" parity="Chip 65 failed" />);
    const chip = document.querySelector('[data-parity="Chip 65 failed"]');
    expect(chip).toHaveStyle({ background: 'var(--mantine-color-bad-light)' });
    const label = screen.getByText('65 failed');
    expect(parityOf(label)).toBe('cl');
    expect(label).toHaveStyle({ color: 'var(--tk-text-bad-small)' });
  });

  it('draws neutral on surface step 3 with an optional count', () => {
    render(
      <CountChip
        count="4"
        label="excluded by state"
        tone="neutral"
        parity="Chip excluded by state"
      />
    );
    expect(
      document.querySelector('[data-parity="Chip excluded by state"]')
    ).toHaveStyle({ background: 'var(--tk-surface-3)' });
    const count = screen.getByText('4');
    expect(parityOf(count)).toBe('cn');
    expect(count).toHaveStyle({ color: 'var(--tk-text-2)' });
  });
});

describe('TeamStrip', () => {
  const points = [
    { username: 'nvance', value: 77, you: false, leader: true },
    { username: 'srivera', value: 48, you: true, leader: false },
    { username: 'kmorgan', value: 5, you: false, leader: false },
  ];

  it('places a dot per person on a 360px axis with a 0 to max scale', () => {
    render(<TeamStrip points={points} max={77} maxLabel="77" />);
    expect(document.querySelector('[data-parity="Axis Line"]')).toBeTruthy();
    const leader = document.querySelector('[data-parity="Dot NV"]');
    expect(leader).toHaveStyle({
      width: '10px',
      left: '350px',
      background: 'var(--tk-fill-gold)',
    });
    const you = document.querySelector('[data-parity="Dot SR"]');
    expect(you).toHaveStyle({
      width: '16px',
      background: 'var(--tk-fill-accent)',
    });
    expect(document.querySelector('[data-parity="Dot KM"]')).toHaveStyle({
      background: 'var(--tk-muted)',
    });
    expect(parityOf(screen.getByText('0'))).toBe('s0');
    expect(parityOf(screen.getByText('77'))).toBe('s1');
  });
});

describe('PushCalendar', () => {
  it('PushCalendar prints counts only on the busiest days', () => {
    render(
      <PushCalendar
        weeks={[
          [
            { date: '2026-09-20', count: 24, inWindow: true, level: 3 },
            { date: '2026-09-21', count: 4, inWindow: true, level: 1 },
          ],
        ]}
      />
    );
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.queryByText('4')).toBeNull();
  });

  it('names days and weeks as the canvas does', () => {
    render(
      <PushCalendar
        weeks={[
          [
            { date: '2026-09-27', count: 3, inWindow: true, level: 1 },
            { date: '2026-09-28', count: 9, inWindow: true, level: 2 },
            { date: '2026-09-29', count: 0, inWindow: false, level: 0 },
            { date: '2026-09-30', count: 0, inWindow: true, level: 0 },
          ],
        ]}
      />
    );
    expect(parityOf(screen.getByText('Sep 27'))).toBe('wk');
    expect(parityOf(screen.getByText('Sun'))).toBe('Sun');
    expect(document.querySelector('[data-parity="Day 9-27"]')).toHaveStyle({
      opacity: '0.35',
    });
    expect(document.querySelector('[data-parity="Day 9-28"]')).toHaveStyle({
      opacity: '0.65',
    });
    expect(document.querySelector('[data-parity="Day 9-29"]')).toHaveStyle({
      outline: '1px solid var(--tk-border-soft)',
    });
    expect(document.querySelector('[data-parity="Day 9-30"]')).toHaveStyle({
      background: 'var(--tk-raised)',
    });
  });
});
