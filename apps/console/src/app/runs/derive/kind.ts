import type { BranchEnrichment } from '@mattstack/rt-client';

import { mrIidOf } from '../mrRef';

export type RunKind = 'work' | 'review' | 'respond' | 'utility';

export function runKind(workType: string): RunKind {
  switch (workType) {
    case 'feature':
    case 'work':
      return 'work';
    case 'review':
      return 'review';
    case 'receive-review':
      return 'respond';
    default:
      return 'utility';
  }
}

function present(s: string | null | undefined): s is string {
  return s != null && s.trim() !== '';
}

export function runTitle(
  run: {
    ticket: string | null;
    branch: string | null;
    work_type: string;
    id: string;
    outcome?: { reviewed?: { iid: number } | null } | null;
  },
  enrichment: {
    ticketTitle?: string | null;
    mrTitle?: string | null;
    /** The MR a review or respond run reads, before rt records it in the
        outcome. */
    mrIid?: number | string | null;
  }
): string {
  const kind = runKind(run.work_type);
  if (kind === 'review' || kind === 'respond') {
    if (present(enrichment.mrTitle)) return enrichment.mrTitle;
    if (present(enrichment.ticketTitle)) return enrichment.ticketTitle;
    const iid = run.outcome?.reviewed?.iid ?? enrichment.mrIid;
    return iid != null ? `Review of !${iid}` : `${run.work_type} run`;
  }
  if (present(enrichment.ticketTitle)) return enrichment.ticketTitle;
  if (present(run.branch)) return run.branch;
  return `${run.work_type} run`;
}

/** The title every surface shows for a run, from its branch enrichment and
    the `mr` field it recorded. */
export function enrichedRunTitle(
  run: Parameters<typeof runTitle>[0],
  enrichment: BranchEnrichment | undefined,
  mrField: string | null | undefined
): string {
  return runTitle(run, {
    ticketTitle: enrichment?.ticket?.title,
    mrIid: enrichment?.mr?.iid ?? mrIidOf(mrField),
  });
}
