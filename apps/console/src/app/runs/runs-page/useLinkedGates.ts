import { useMemo } from 'react';
import type { GateRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';

import { runIdOfGate } from '../../../shared/gate-run';
import { client } from '../../api';

const NO_GATES: GateRow[] = [];

/** Every gate linked to any run, grouped by the run it belongs to. One fetch
    serves every decision count on the runs page. */
export function useLinkedGates() {
  const query = useQuery({
    queryKey: ['gates', 'linked'],
    queryFn: async () => {
      // The route reads the string '1'; the client types the validator's
      // parsed output (a boolean) instead of the wire value.
      const res = await client.api.gates.$get({
        query: { linked: '1' as unknown as boolean },
      });
      if (!res.ok) throw new Error(`gates list failed: ${res.status}`);
      return res.json();
    },
  });
  const rows = query.data?.gates;
  // A failed request reads as loaded with no gates, so nothing waits on it forever.
  const loaded = query.isSuccess || query.isError;
  return useMemo(() => {
    const all = rows ?? NO_GATES;
    const byRun = new Map<string, GateRow[]>();
    const linked: GateRow[] = [];
    for (const g of all) {
      const runId = runIdOfGate(g);
      if (!runId) continue;
      linked.push(g);
      const list = byRun.get(runId);
      if (list) list.push(g);
      else byRun.set(runId, [g]);
    }
    return { byRun, all: linked, loaded };
  }, [rows, loaded]);
}
