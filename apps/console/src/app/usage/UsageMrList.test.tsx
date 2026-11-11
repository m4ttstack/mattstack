import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { UsageBilling, UsageTotals } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

const { CostCell } = await import('./UsageMrList');

const totals = (cost: number): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  messages: 1,
  cost,
  unpricedTokens: 0,
});

const split = (
  metered: number,
  plan: number,
  unknown: number
): Record<UsageBilling, UsageTotals> => ({
  metered: totals(metered),
  plan: totals(plan),
  unknown: totals(unknown),
});

function cell(byBilling: Record<UsageBilling, UsageTotals>) {
  const { getByTestId, queryByTestId } = renderWithProviders(
    <CostCell byBilling={byBilling} />
  );
  return {
    metered: getByTestId('cost-metered').textContent,
    plan: queryByTestId('cost-plan')?.textContent ?? null,
    unknown: queryByTestId('cost-unknown')?.textContent ?? null,
  };
}

describe('CostCell', () => {
  it('shows metered cost with plan usage under it', () => {
    expect(cell(split(4.6, 1480, 0))).toEqual({
      metered: '$4.60',
      plan: '$1,480 on plan',
      unknown: null,
    });
  });

  it('leaves the plan line out when nothing ran on a plan', () => {
    expect(cell(split(4.6, 0, 0))).toEqual({
      metered: '$4.60',
      plan: null,
      unknown: null,
    });
  });

  it('shows cost with no account beside plan usage', () => {
    expect(cell(split(0, 1480, 32.5))).toEqual({
      metered: '$0.00',
      plan: '$1,480 on plan',
      unknown: '$32.50 unknown',
    });
  });

  it('shows cost from before accounts were recorded as unknown, not free', () => {
    expect(cell(split(0, 0, 32.5))).toEqual({
      metered: '$0.00',
      plan: null,
      unknown: '$32.50 unknown',
    });
  });
});
