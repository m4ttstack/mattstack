import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecisionStage } from '../derive/record';
import { AT, gateOf } from './decisionFixtures';

const { DecisionsTab } = await import('./DecisionsTab');

const MIN = 60_000;

const plan: DecisionStage = {
  stage: 'plan',
  gates: [gateOf({ id: 'g-1' }), gateOf({ id: 'g-2' })],
  answered: 2,
  durationMs: 12 * MIN,
  overrode: true,
};
const ship: DecisionStage = {
  stage: 'ship',
  gates: [
    gateOf({
      id: 'g-3',
      status: 'closed',
      closedReason: 'superseded',
      answer: null,
      closedAt: AT,
    }),
  ],
  answered: 0,
  durationMs: null,
  overrode: false,
};

describe('DecisionsTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('indexes the stages with their counts and an override mark', () => {
    renderWithProviders(
      <DecisionsTab groups={[plan, ship]} byStage evidence={null} />
    );
    const nav = screen.getByRole('navigation', { name: 'Decisions by stage' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['plan2', 'ship0']);
    expect(
      within(nav).getAllByLabelText('an answer went against the recommendation')
    ).toHaveLength(1);
    expect(screen.getByText('you overrode the pick')).toBeInTheDocument();
  });

  it('heads each stage with its decisions and time, and keeps a superseded gate muted', () => {
    const { container } = renderWithProviders(
      <DecisionsTab groups={[plan, ship]} byStage evidence={null} />
    );
    expect(
      container.querySelector('[data-stage-group="plan"]')
    ).toHaveTextContent('plan2 decisions · 12m');
    expect(
      container.querySelector('[data-stage-group="ship"]')
    ).toHaveTextContent('ship0 decisions');
    const superseded = container.querySelector('[data-gate-id="g-3"]');
    expect(superseded).toHaveAttribute('data-muted', 'true');
    expect(
      within(superseded as HTMLElement).getByText('superseded')
    ).toBeInTheDocument();
  });

  it('scrolls to a stage and marks it current when picked', async () => {
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {});
    renderWithProviders(
      <DecisionsTab groups={[plan, ship]} byStage evidence={null} />
    );
    const shipLink = screen.getByRole('button', { name: /ship/ });
    await userEvent.click(shipLink);
    expect(scroll).toHaveBeenCalled();
    expect(shipLink).toHaveAttribute('data-active', 'true');
  });

  it('lists a one-stage run’s gates with no index or stage heads', () => {
    const { container } = renderWithProviders(
      <DecisionsTab groups={[plan]} byStage={false} evidence={null} />
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('[data-stage-group]')).toBeNull();
    expect(container.querySelectorAll('[data-gate-id]')).toHaveLength(2);
  });

  it('says so when the run has no decisions', () => {
    renderWithProviders(<DecisionsTab groups={[]} byStage evidence={null} />);
    expect(screen.getByText('No decisions on this run.')).toBeInTheDocument();
  });
});
