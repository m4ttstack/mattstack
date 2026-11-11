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

const pairs = (byBilling: Record<UsageBilling, UsageTotals>) =>
  billingStats(byBilling).map(s => [s.value, s.label]);

describe('billingStats', () => {
  it('leads with metered cost, with plan usage beside it', () => {
    expect(pairs(split(12.5, 1500, 0))).toEqual([
      ['$12.50', 'metered'],
      ['$1,500', 'on plan'],
    ]);
    const { container } = renderWithProviders(
      <UsageStats stats={billingStats(split(12.5, 1500, 0))} />
    );
    const text = (part: string) =>
      [...container.querySelectorAll(`[data-parity="${part}"]`)].map(
        el => el.textContent
      );
    expect(text('value')).toEqual(['$12.50', '$1,500']);
    expect(text('label')).toEqual(['metered', 'on plan']);
  });

  it('adds unknown only when some cost has no account', () => {
    expect(pairs(split(0, 0, 3.2))).toEqual([
      ['$0.00', 'metered'],
      ['$0.00', 'on plan'],
      ['$3.20', 'unknown'],
    ]);
  });
});
