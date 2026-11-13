import type { GateRow, RunSummary } from '@mattstack/rt-client';

import { forgeOf, mrRefText } from '../../forgeNoun';

export const runHref = (run: RunSummary) => `/runs/${run.repo}/${run.id}`;

/** The run page, scrolled to the gate's panel. */
export const gateHref = (run: RunSummary, gate: GateRow) =>
  `${runHref(run)}#gate-${encodeURIComponent(gate.id)}`;

/** The ticket, else the MR or PR a review or respond run read. */
export function ticketOf(run: RunSummary): string | null {
  if (run.ticket != null) return run.ticket;
  const reviewed = run.outcome?.reviewed;
  if (!reviewed) return null;
  return mrRefText(forgeOf(reviewed.url, run.repo), reviewed.iid);
}
