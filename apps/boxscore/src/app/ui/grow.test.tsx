import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '@mattstack/app-kit/test-utils';
import { fixtureDetail, fixtureLeaderboard } from '../../server/fixture/index';
import { ReciprocityEvidence } from '../detail/evidence/ReciprocityEvidence';
import grow from './grow.module.css';
import { TeamStrip } from './TeamStrip';

const points = [
  { username: 'nvance', value: 9, you: false, leader: true },
  { username: 'srivera', value: 5, you: true, leader: false },
];

/** Answers the reduced-motion query as the viewer's setting, every other query as the polyfill does. */
function preferReducedMotion() {
  const real = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query =>
    query.includes('prefers-reduced-motion')
      ? ({
          ...real(query),
          matches: true,
          media: query,
        } as MediaQueryList)
      : real(query)
  );
}

function renderReciprocity() {
  const detail = fixtureDetail('srivera', false)!;
  return render(
    <ReciprocityEvidence
      ev={detail.evidence.reciprocity!}
      users={fixtureLeaderboard(false).users}
      username="srivera"
      statKey="reciprocity"
      window={detail.window}
    />
  );
}

afterEach(() => vi.restoreAllMocks());

describe('grow-in', () => {
  it('fades the team strip dots in, staggered', () => {
    const { container } = render(
      <TeamStrip points={points} max={10} maxLabel="10" />
    );
    const dots = [...container.querySelectorAll('[data-parity^="Dot"]')];
    expect(dots).toHaveLength(2);
    expect(grow.fade).toBeTruthy();
    for (const dot of dots) expect(dot).toHaveClass(grow.fade!);
    expect((dots[1] as HTMLElement).style.getPropertyValue('--grow-i')).toBe(
      '1'
    );
  });

  it('grows the give and take bars from the left', () => {
    const { container } = renderReciprocity();
    const bars = [...container.querySelectorAll('[data-parity="Bar"]')];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(bar).toHaveClass(grow.x!);
  });

  it('drops the animation when the viewer prefers reduced motion', () => {
    preferReducedMotion();
    const { container } = render(
      <TeamStrip points={points} max={10} maxLabel="10" />
    );
    for (const dot of container.querySelectorAll('[data-parity^="Dot"]'))
      expect(dot).not.toHaveClass(grow.fade!);
    const { container: panel } = renderReciprocity();
    const bars = [...panel.querySelectorAll('[data-parity="Bar"]')];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(bar).not.toHaveClass(grow.x!);
  });
});
