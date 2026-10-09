import { useEffect } from 'react';
import type {
  BranchEnrichment,
  RunDetail,
  RunSummary,
} from '@mattstack/rt-client';
import {
  keepPreviousData,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';

import { client } from '../api';
import { runDetailKey } from './derive/day';

/** The spec's slow-poll safety net. The websocket is the live path; this is
    what catches a socket that dropped without us noticing. */
const POLL_MS = 30_000;

/** A failed API answer: the body's `error` text, and the HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function readApiError(
  res: { status: number; json: () => Promise<unknown> },
  label: string
): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const error =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : null;
  return new ApiError(
    res.status,
    typeof error === 'string' && error.trim()
      ? error.trim()
      : `${label}: ${res.status}`
  );
}

export const isNotFound = (err: unknown) =>
  err instanceof ApiError && err.status === 404;

/** One retry for a server or network failure, none for a 4xx: an unknown
    run or a refused read will not change on a second ask, and an outage
    should say so in about a second, not after three backed-off retries. */
export const retryOnce = (failures: number, err: unknown) =>
  !(err instanceof ApiError && err.status >= 400 && err.status < 500) &&
  failures < 1;

export function useRunList(repo?: string) {
  return useQuery({
    queryKey: ['runs', repo ?? null],
    queryFn: async () => {
      const res = await client.api.runs.$get({ query: repo ? { repo } : {} });
      if (!res.ok) throw await readApiError(res, 'runs list failed');
      // Only the design fixture's answer carries `asOf` (see derive/clock.ts).
      return (await res.json()) as { runs: RunSummary[]; asOf?: number };
    },
    refetchInterval: POLL_MS,
    retry: retryOnce,
    // The runs page is filtered AND hot. Holding the previous list through a
    // filter change is worth more here than the loading branch suspense
    // would remove -- which is why this one view is not a suspense query.
    placeholderData: keepPreviousData,
  });
}

/**
 * One socket per tab. Invalidating on EVERY message is safe only because the
 * server already filtered the upstream relay to two topics -- run-updated
 * ('runs') and gate/* ('gates'), see src/server/index.ts's relay list --
 * the daemon multiplexes ports/status/system-processes/project-mrs through
 * the same upstream socket, and without that filter this would refetch on
 * every unrelated daemon tick.
 */
export function useRunEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const socket = new WebSocket(url);
    socket.onmessage = () => {
      // Three surfaces: ['runs'] is the runs list, ['run'] every open
      // detail, ['gates'] every gate read the runs and run pages render.
      // run-updated fires on every pipeline write (emit_update in
      // pipeline-state.sh), gate/* on every gate open/answer/park -- this is
      // what keeps the detail page and the gate surfaces both live.
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['run'] });
      void queryClient.invalidateQueries({ queryKey: ['gates'] });
    };
    return () => socket.close();
  }, [queryClient]);
}

function runQuery(repo: string, runId: string) {
  return {
    queryKey: ['run', repo, runId],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'].$get({
        param: { repo, runId },
      });
      if (!res.ok) throw await readApiError(res, 'run detail failed');
      return res.json();
    },
    retry: retryOnce,
    // The websocket is the live path; this is the same slow-poll safety net
    // the board list uses, for a socket that dropped without us noticing.
    refetchInterval: POLL_MS,
  };
}

// The detail view cannot render without its run, so this one -- unlike
// useRunList above -- is a suspense query: no loading branch to forget.
export function useRun(repo: string, runId: string) {
  return useSuspenseQuery(runQuery(repo, runId));
}

/** The same run read without suspending, for page chrome that draws a
    placeholder until it lands. */
export function useRunChrome(repo: string, runId: string) {
  return useQuery(runQuery(repo, runId));
}

/** Several runs read at once, keyed by `runDetailKey`, sharing each run page's
    cache; a run whose read has not landed is absent, and `pending` says
    some have not. A finished run no longer changes, so it is not polled. */
export function useRunDetails(
  runs: Pick<RunSummary, 'repo' | 'id' | 'ended_at'>[]
) {
  return useQueries({
    queries: runs.map(r => ({
      ...runQuery(r.repo, r.id),
      ...(r.ended_at != null ? { refetchInterval: false as const } : {}),
    })),
    combine: results => {
      const details = new Map<string, RunDetail>();
      results.forEach((res, i) => {
        if (res.data)
          details.set(runDetailKey(runs[i]!), res.data as unknown as RunDetail);
      });
      return { details, pending: results.some(r => r.isPending) };
    },
  });
}

/** Search states the retention window rather than hardcoding it -- rt owns
    `rt.runsPruneDays` (default 30), and the console renders whatever the
    resolver actually returns. */
export function useRunsPruneDays() {
  return useQuery({
    queryKey: ['settings', 'runsPruneDays'],
    queryFn: async () => {
      const res = await client.api.settings['runs-prune-days'].$get();
      if (!res.ok)
        throw new Error(`runs prune-days read failed: ${res.status}`);
      const { days } = await res.json();
      return days;
    },
  });
}

/** The Linear workspace slug (team-scoped, under `mattstack.integrations`).
    The branch cache only enriches branches the board syncs, so a ticket on
    any other prefix has an id and no url; the slug is what lets the client
    build one from the id alone. Null when the team has not set it. */
export function useLinearWorkspace() {
  return useQuery({
    queryKey: ['settings', 'linearWorkspace'],
    queryFn: async () => {
      const res = await client.api.settings['linear-workspace'].$get();
      if (!res.ok)
        throw new Error(`linear workspace read failed: ${res.status}`);
      const { workspace } = await res.json();
      return workspace;
    },
  });
}

/** The server's cap on branches per enrich request. */
const ENRICH_BATCH = 100;

/** POSTs of at most ENRICH_BATCH branches each, merged into one answer,
    keyed on the de-duplicated, sorted branch list -- an unsorted key would
    treat the same visible set in a different order as a different query
    and refetch instead of hitting cache. Skips the request entirely for an
    empty board rather than POSTing `{branches: []}`. */
export function useRunsEnrich(branches: string[]) {
  const key = [...new Set(branches)].sort();
  return useQuery({
    queryKey: ['runs-enrich', key],
    queryFn: async (): Promise<Record<string, BranchEnrichment>> => {
      const batches: string[][] = [];
      for (let i = 0; i < key.length; i += ENRICH_BATCH)
        batches.push(key.slice(i, i + ENRICH_BATCH));
      const answers = await Promise.all(
        batches.map(async branches => {
          const res = await client.api.runs.enrich.$post({
            json: { branches },
          });
          if (!res.ok) throw new Error(`runs enrich failed: ${res.status}`);
          return res.json();
        })
      );
      return Object.assign({}, ...answers);
    },
    enabled: key.length > 0,
    staleTime: 60_000,
  });
}
