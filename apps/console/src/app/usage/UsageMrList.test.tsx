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

function cell(total: number, byBilling: Record<UsageBilling, UsageTotals>) {
  const { getByTestId, queryByTestId } = renderWithProviders(
    <CostCell totals={totals(total)} byBilling={byBilling} />
  );
  return {
    total: getByTestId('cost-total').textContent,
    metered: queryByTestId('cost-metered')?.textContent ?? null,
    plan: queryByTestId('cost-plan')?.textContent ?? null,
    unknown: queryByTestId('cost-unknown')?.textContent ?? null,
  };
}

describe('CostCell', () => {
  it('leads with the total and breaks it down by billing', () => {
    expect(cell(1484.6, split(4.6, 1480, 0))).toEqual({
      total: '$1,485',
      metered: '$4.60 metered',
      plan: '$1,480 on plan',
      unknown: null,
    });
  });

  it('leaves out a part that is zero', () => {
    expect(cell(4.6, split(4.6, 0, 0))).toEqual({
      total: '$4.60',
      metered: '$4.60 metered',
      plan: null,
      unknown: null,
    });
  });

  it('adds unknown beside the known parts', () => {
    expect(cell(1512.5, split(0, 1480, 32.5))).toEqual({
      total: '$1,513',
      metered: null,
      plan: '$1,480 on plan',
      unknown: '$32.50 unknown',
    });
  });

  it('shows only the total when no cost has a known account', () => {
    expect(cell(32.5, split(0, 0, 32.5))).toEqual({
      total: '$32.50',
      metered: null,
      plan: null,
      unknown: null,
    });
  });
});
