import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { UsageBilling, UsageTotals } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

const { billingStats, UsageStats } = await import('./UsageStats');

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

const pairs = (total: number, byBilling?: Record<UsageBilling, UsageTotals>) =>
  billingStats(total, byBilling).map(s => [s.value, s.label]);

describe('billingStats', () => {
  it('leads with the total, then metered and on plan', () => {
    expect(pairs(1512.5, split(12.5, 1500, 0))).toEqual([
      ['$1,513', 'estimated cost'],
      ['$12.50', 'metered'],
      ['$1,500', 'on plan'],
    ]);
    const { container } = renderWithProviders(
      <UsageStats stats={billingStats(1512.5, split(12.5, 1500, 0))} />
    );
    const text = (part: string) =>
      [...container.querySelectorAll(`[data-parity="${part}"]`)].map(
        el => el.textContent
      );
    expect(text('value')).toEqual(['$1,513', '$12.50', '$1,500']);
    expect(text('label')).toEqual(['estimated cost', 'metered', 'on plan']);
  });

  it('adds unknown beside the known parts', () => {
    expect(pairs(1503.2, split(0, 1500, 3.2))).toEqual([
      ['$1,503', 'estimated cost'],
      ['$0.00', 'metered'],
      ['$1,500', 'on plan'],
      ['$3.20', 'unknown'],
    ]);
  });

  it('shows only the total when every cost is unknown', () => {
    expect(pairs(3.2, split(0, 0, 3.2))).toEqual([['$3.20', 'estimated cost']]);
  });

  it('shows only the total while the split loads', () => {
    expect(pairs(0, undefined)).toEqual([['$0.00', 'estimated cost']]);
  });

  it('carries the tone onto each stat', () => {
    expect(billingStats(5, split(5, 0, 0), 'gray').map(s => s.tone)).toEqual([
      'gray',
      'gray',
      'gray',
    ]);
  });
});
