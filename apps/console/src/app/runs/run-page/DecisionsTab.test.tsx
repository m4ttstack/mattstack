import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DecisionStage } from '../derive/record';
import { AT, gateOf } from './decisionFixtures';

const { DecisionsTab } = await import('./DecisionsTab');

const MIN = 60_000;

const plan: DecisionStage = {
  stage: 'plan',
  gates: [gateOf({ id: 'g-1' }), gateOf({ id: 'g-2' }), gateOf({ id: 'g-4' })],
  answered: 3,
  durationMs: 12 * MIN,
  overrides: 1,
  status: 'done',
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
  overrides: 0,
  status: 'done',
};
const evidence: DecisionStage = {
  stage: 'evidence',
  gates: [gateOf({ id: 'g-5' })],
  answered: 1,
  durationMs: 44 * MIN,
  overrides: 2,
  status: 'done',
};

describe('DecisionsTab', () => {
  it('carries the stages in the log, with no index beside it', () => {
    const { container } = renderWithProviders(
      <DecisionsTab groups={[plan, ship]} byStage evidence={null} />
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText(/by stage/i)).toBeNull();
    expect(screen.queryByText('you overrode the pick')).toBeNull();
    const log = screen.getByTestId('decision-log');
    expect(
      [...log.querySelectorAll('[data-stage-group]')].map(e =>
        e.getAttribute('data-stage-group')
      )
    ).toEqual(['plan', 'ship']);
    expect(container.querySelector('[data-parity="Decision log"]')).toBe(log);
  });

  it('heads each stage with its decisions, time and overrides', () => {
    const { container } = renderWithProviders(
      <DecisionsTab groups={[plan, ship, evidence]} byStage evidence={null} />
    );
    const head = (stage: string) =>
      container.querySelector(`[data-stage-group="${stage}"]`)!;
    expect(head('plan')).toHaveTextContent(
      /^plan3 decisions · 12m · 1 override$/
    );
    expect(head('ship')).toHaveTextContent(/^ship0 decisions$/);
    expect(head('evidence')).toHaveTextContent(
      /^evidence1 decision · 44m · 2 overrides$/
    );
    expect(
      within(head('plan') as HTMLElement).getByLabelText('done')
    ).toBeInTheDocument();
  });

  it('keeps a superseded gate muted', () => {
    const { container } = renderWithProviders(
      <DecisionsTab groups={[plan, ship]} byStage evidence={null} />
    );
    const superseded = container.querySelector('[data-gate-id="g-3"]');
    expect(superseded).toHaveAttribute('data-muted', 'true');
    expect(
      within(superseded as HTMLElement).getByText('superseded')
    ).toBeInTheDocument();
  });

  it('lists a one-stage run’s gates with no stage heads', () => {
    const { container } = renderWithProviders(
      <DecisionsTab groups={[plan]} byStage={false} evidence={null} />
    );
    expect(container.querySelector('[data-stage-group]')).toBeNull();
    expect(container.querySelectorAll('[data-gate-id]')).toHaveLength(3);
  });

  it('puts the evidence in a rail beside the log', () => {
    const { container } = renderWithProviders(
      <DecisionsTab
        groups={[plan]}
        byStage
        evidence={<div data-testid="evidence-column" />}
      />
    );
    const rail = container.querySelector('[data-parity="Evidence rail"]');
    expect(rail).not.toBeNull();
    expect(
      within(rail as HTMLElement).getByTestId('evidence-column')
    ).toBeInTheDocument();
  });

  it('says so when the run has no decisions', () => {
    renderWithProviders(<DecisionsTab groups={[]} byStage evidence={null} />);
    expect(screen.getByText('No decisions on this run.')).toBeInTheDocument();
  });
});
