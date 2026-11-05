import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { client } from '../api';
import { readApiError } from '../runs/useRuns';

/** The sweep's period: nothing newer exists sooner than this. */
const STALE_MS = 60_000;

/** A range in days, or null for everything in the store. */
export type UsageRange = number | null;

/** The daemon's cap; trends always needs a range. */
const ALL_DAYS = 3650;

export function useUsageMrs(range: UsageRange) {
  return useQuery({
    queryKey: ['usage', 'mrs', range],
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await client.api.usage.mrs.$get({
        query: range === null ? {} : { days: String(range) },
      });
      if (!res.ok) throw await readApiError(res, 'usage');
      return res.json();
    },
  });
}

export function useUsageTrends(range: UsageRange) {
  return useQuery({
    queryKey: ['usage', 'trends', range],
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await client.api.usage.trends.$get({
        query: { days: String(range ?? ALL_DAYS) },
      });
      if (!res.ok) throw await readApiError(res, 'usage trends');
      return res.json();
    },
  });
}

export function useUsageMr(mrKey: string) {
  return useQuery({
    queryKey: ['usage', 'mr', mrKey],
    staleTime: STALE_MS,
    queryFn: async () => {
      const res = await client.api.usage.mr.$get({ query: { mrKey } });
      if (!res.ok) throw await readApiError(res, 'usage');
      return res.json();
    },
  });
}

export function useUsageStatus() {
  return useQuery({
    queryKey: ['usage', 'status'],
    staleTime: STALE_MS,
    queryFn: async () => {
      const res = await client.api.usage.status.$get();
      if (!res.ok) throw await readApiError(res, 'usage status');
      return res.json();
    },
  });
}
