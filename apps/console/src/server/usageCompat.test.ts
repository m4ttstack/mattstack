// @vitest-environment node
import type {
  UsageMrData,
  UsageMrsData,
  UsageTotals,
  UsageTrendsData,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { normalizeMr, normalizeMrs, normalizeTrends } from './usageCompat';

const totals = (cost: number): UsageTotals => ({
  input: 1,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  messages: 5,
  cost,
  unpricedTokens: 0,
});
const ZERO: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  messages: 0,
  cost: 0,
  unpricedTokens: 0,
};
const unknownOnly = (t: UsageTotals) => ({
  metered: ZERO,
  plan: ZERO,
  unknown: t,
});

/** What a daemon from before the billing split sends. */
const strip = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key, v) =>
      key === 'byBilling' || key === 'accounts' ? undefined : v
    )
  );

const row = {
  mrKey: 'remote:h%2Fp!1',
  url: null,
  ticket: null,
  branch: null,
  firstActivity: 1,
  lastActivity: 2,
  totals: totals(7),
  byBilling: unknownOnly(totals(7)),
  costByKind: { work: 7, review: 0, respond: 0, doctor: 0, other: 0 },
  runCount: 1,
  roundCount: 0,
};
const mrs: UsageMrsData = {
  mrs: [row],
  summary: {
    mrCount: 1,
    totals: totals(7),
    byBilling: unknownOnly(totals(7)),
    medianCost: 7,
  },
};
const entry = {
  runId: 'r',
  sessionId: null,
  kind: 'work',
  round: null,
  pipeline: null,
  status: null,
  startedAt: 1,
  endedAt: 2,
  firstActivity: 1,
  lastActivity: 2,
  totals: totals(3),
  byBilling: { metered: totals(1), plan: totals(2), unknown: ZERO },
  accounts: [{ account: 'a', label: null, billing: 'metered' }],
  byModel: [],
  main: totals(3),
  subagent: ZERO,
  stages: [],
};
const mr = {
  mrKey: 'remote:h%2Fp!1',
  url: null,
  ticket: null,
  branch: null,
  firstActivity: 1,
  lastActivity: 2,
  totals: totals(3),
  byBilling: { metered: totals(1), plan: totals(2), unknown: ZERO },
  costByKind: { work: 3, review: 0, respond: 0, doctor: 0, other: 0 },
  byModel: [],
  main: totals(3),
  subagent: ZERO,
  outsideRuns: ZERO,
  runs: [entry],
} as unknown as UsageMrData;
const trends: UsageTrendsData = {
  weeks: [],
  totals: totals(9),
  byBilling: { metered: totals(4), plan: totals(5), unknown: ZERO },
  byPipeline: [],
  byModel: [],
};

describe('normalizeMrs', () => {
  it('counts an older daemon payload as all unknown', () => {
    const out = normalizeMrs(strip(mrs));
    expect(out?.summary.byBilling).toEqual(unknownOnly(totals(7)));
    expect(out?.mrs[0]?.byBilling).toEqual(unknownOnly(totals(7)));
    expect(out).toEqual(mrs);
  });

  it('passes a current payload through unchanged', () => {
    expect(normalizeMrs(mrs)).toEqual(mrs);
  });

  it('keeps an empty reply empty', () => {
    expect(normalizeMrs(null)).toBeNull();
    expect(normalizeMrs(undefined)).toBeUndefined();
  });
});

describe('normalizeMr', () => {
  it('gives the MR and each entry the missing fields', () => {
    const out = normalizeMr(strip(mr));
    expect(out?.byBilling).toEqual(unknownOnly(totals(3)));
    expect(out?.runs[0]?.byBilling).toEqual(unknownOnly(totals(3)));
    expect(out?.runs[0]?.accounts).toEqual([]);
  });

  it('passes a current payload through unchanged', () => {
    expect(normalizeMr(mr)).toEqual(mr);
  });

  it('keeps a missing MR null', () => {
    expect(normalizeMr(null)).toBeNull();
  });
});

describe('normalizeTrends', () => {
  it('counts an older daemon payload as all unknown', () => {
    const out = normalizeTrends(strip(trends));
    expect(out?.byBilling).toEqual(unknownOnly(totals(9)));
  });

  it('passes a current payload through unchanged', () => {
    expect(normalizeTrends(trends)).toEqual(trends);
  });
});
