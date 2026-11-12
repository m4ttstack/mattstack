import type {
  UsageBilling,
  UsageMrData,
  UsageMrsData,
  UsageTotals,
  UsageTrendsData,
} from '@mattstack/rt-client';

type Billing = Record<UsageBilling, UsageTotals>;

const ZERO: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  messages: 0,
  cost: 0,
  unpricedTokens: 0,
};

/** An rt daemon older than the console recorded no accounts, so all of it is unknown. */
function withBilling<T extends { totals: UsageTotals; byBilling?: Billing }>(
  value: T
): T & { byBilling: Billing } {
  return {
    ...value,
    byBilling: value.byBilling ?? {
      metered: ZERO,
      plan: ZERO,
      unknown: value.totals,
    },
  };
}

export function normalizeMrs<T extends UsageMrsData | null | undefined>(
  data: T
): T {
  if (!data) return data;
  return {
    ...data,
    mrs: data.mrs.map(withBilling),
    summary: withBilling(data.summary),
  };
}

export function normalizeMr<T extends UsageMrData | null | undefined>(
  data: T
): T {
  if (!data) return data;
  return {
    ...withBilling(data),
    runs: data.runs.map(entry => ({
      ...withBilling(entry),
      accounts: entry.accounts ?? [],
    })),
  };
}

export function normalizeTrends<T extends UsageTrendsData | null | undefined>(
  data: T
): T {
  if (!data) return data;
  return withBilling(data);
}
