import type { GateRow, RunSummary } from '@mattstack/rt-client';

export const runHref = (run: RunSummary) => `/runs/${run.repo}/${run.id}`;

/** The run page, scrolled to the gate's panel. */
export const gateHref = (run: RunSummary, gate: GateRow) =>
  `${runHref(run)}#gate-${encodeURIComponent(gate.id)}`;

/** The ticket, else the MR a review or respond run read. */
export const ticketOf = (run: RunSummary) =>
  run.ticket ?? (run.outcome?.reviewed ? `!${run.outcome.reviewed.iid}` : null);
