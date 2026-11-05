import type { BranchEnrichment } from '@mattstack/rt-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { client } from '../api';
import { readApiError, useRunsEnrich } from '../runs/useRuns';

const STALE_MS = 60_000;

/** A range in days, or null for everything in the store. */
export type UsageRange = number | null;

/** The daemon's cap; trends always needs a range. */
const ALL_DAYS = 3650;

export function useUsageMrs(range: UsageRange, repo: string | null = null) {
  return useQuery({
    queryKey: ['usage', 'mrs', range, repo],
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await client.api.usage.mrs.$get({
        query: {
          ...(range === null ? {} : { days: String(range) }),
          ...(repo ? { repo } : {}),
        },
      });
      if (!res.ok) throw await readApiError(res, 'usage');
      return res.json();
    },
  });
}

export function useUsageTrends(
  days: number | null,
  repo: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: ['usage', 'trends', days, repo],
    enabled,
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await client.api.usage.trends.$get({
        query: {
          days: String(Math.min(days ?? ALL_DAYS, ALL_DAYS)),
          ...(repo ? { repo } : {}),
        },
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

/** A missing cost only hides one number on the run page, so it never retries. */
export function useUsageRun(runId: string) {
  return useQuery({
    queryKey: ['usage', 'run', runId],
    staleTime: STALE_MS,
    retry: false,
    queryFn: async () => {
      const res = await client.api.usage.run.$get({ query: { runId } });
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

export type EnrichmentOf = (
  branch: string | null
) => BranchEnrichment | undefined;

/** Titles are not in the store: they come from the same branch enrichment
    the runs pages read. */
export function useUsageEnrichment(
  branches: Array<string | null>
): EnrichmentOf {
  const known = branches.filter((b): b is string => b !== null);
  const enrich = useRunsEnrich(known).data as
    Record<string, BranchEnrichment> | undefined;
  return branch => (branch ? enrich?.[branch] : undefined);
}
