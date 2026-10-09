import { useMemo } from 'react';
import type { GateRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';

import { runIdOfGate } from '../../../shared/gate-run';
import { client } from '../../api';

const NO_GATES: GateRow[] = [];

/** Every gate linked to the run, in every status. The `['gates', ...]` key
    sits under the `gates` prefix `useRunEvents` invalidates, so the socket
    keeps it live. A daemon older than the `run` filter returns every gate,
    hence the narrowing here as well as on the server. */
export function useRunGates(runId: string) {
  const query = useQuery({
    queryKey: ['gates', 'run', runId],
    queryFn: async () => {
      const res = await client.api.gates.$get({ query: { run: runId } });
      if (!res.ok) throw new Error(`gates list failed: ${res.status}`);
      return res.json();
    },
  });
  const rows = query.data?.gates;
  const gates = useMemo(
    () => rows?.filter(g => runIdOfGate(g) === runId) ?? NO_GATES,
    [rows, runId]
  );
  const asOf =
    query.data && 'asOf' in query.data
      ? (query.data.asOf as number | undefined)
      : undefined;
  return { gates, isLoading: query.isLoading, asOf };
}
