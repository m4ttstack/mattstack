import type { RunSummary } from '@mattstack/rt-client';

export const runHref = (run: RunSummary) => `/runs/${run.repo}/${run.id}`;

/** The ticket, else the MR a review or respond run read. */
export const ticketOf = (run: RunSummary) =>
  run.ticket ?? (run.outcome?.reviewed ? `!${run.outcome.reviewed.iid}` : null);
