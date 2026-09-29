import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureLeaderboard } from '../../server/fixture/index';
import { METRICS, setMetricRank } from '../../shared/metrics';
import classes from './detail.module.css';
import { PersonSummary } from './PersonSummary';

const layer = (root: Element, name: string) =>
  root.querySelector(`[data-parity="${name}"]`);

function rankedEverywhere(rank: number) {
  const data = structuredClone(fixtureLeaderboard(false));
  const person = data.users.find(u => u.username === 'srivera')!;
  for (const d of METRICS) setMetricRank(person.metrics, d, rank);
  return { data, person };
}

describe('PersonSummary', () => {
  it('wraps a long Leads line inside its own cell, with the whole list in a tooltip', async () => {
    const user = userEvent.setup();
    const { data, person } = rankedEverywhere(1);
    const { container } = renderWithProviders(
      <PersonSummary users={data.users} person={person} window={data.window} />
    );
    const cell = layer(container, 'Sum Leads')!;
    const sub = layer(cell, 'Sum Sub')!;
    expect(cell).toHaveClass(classes.sumCell!);
    expect(sub).toHaveClass(classes.sumSubWrap!);
    const full = sub.textContent!;
    expect(full.split(', ').length).toBeGreaterThan(5);
    await user.hover(sub);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(full);
  });

  it('keeps the plain one-line sub when the person leads nothing', () => {
    const { data, person } = rankedEverywhere(2);
    const { container } = renderWithProviders(
      <PersonSummary users={data.users} person={person} window={data.window} />
    );
    const sub = layer(layer(container, 'Sum Leads')!, 'Sum Sub')!;
    expect(sub).toHaveTextContent('none this window');
    expect(sub).not.toHaveClass(classes.sumSubWrap!);
  });
});
