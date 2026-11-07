import { useEffect, useMemo, useState } from 'react';
import type { GateRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';

import { isExpired, slackGateView } from '../../shared/slack-gate';
import { client } from '../api';
import { LIST_GC_MS, POLL_MS, readApiError, retryOnce } from '../runs/useRuns';

export const SLACK_GATES_KEY = ['gates', 'slack'] as const;

const NO_GATES: GateRow[] = [];
const CLOCK_TICK_MS = 30_000;

/** The current time, ticking so a countdown moves and an expired request
    leaves without a refetch. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The open Slack chat requests that have not expired, and what a teammate
    starts a message with to ask the bot back. The page and the rail's count
    read the same query. */
export function useSlackGates() {
  const now = useNow();
  const query = useQuery({
    queryKey: SLACK_GATES_KEY,
    queryFn: async () => {
      const res = await client.api.gates.slack.$get();
      if (!res.ok) throw await readApiError(res, 'slack gates failed');
      return res.json();
    },
    retry: retryOnce,
    refetchInterval: POLL_MS,
    gcTime: LIST_GC_MS,
  });
  const rows = query.data?.gates;
  const gates = useMemo(
    () =>
      rows ? rows.filter(g => !isExpired(slackGateView(g), now)) : NO_GATES,
    [rows, now]
  );
  return useMemo(
    () => ({
      gates,
      now,
      trigger: query.data?.trigger,
      loaded: query.isSuccess,
      failed: query.isError,
      updatedAt: query.dataUpdatedAt,
      refetch: query.refetch,
    }),
    [
      gates,
      now,
      query.data?.trigger,
      query.isSuccess,
      query.isError,
      query.dataUpdatedAt,
      query.refetch,
    ]
  );
}
