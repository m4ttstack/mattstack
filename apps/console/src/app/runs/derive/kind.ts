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
  },
  enrichment: { ticketTitle?: string | null; mrTitle?: string | null }
): string {
  if (present(enrichment.ticketTitle)) return enrichment.ticketTitle;
  if (present(run.branch)) return run.branch;
  const kind = runKind(run.work_type);
  if ((kind === 'review' || kind === 'respond') && present(enrichment.mrTitle))
    return enrichment.mrTitle;
  return `${run.work_type} · ${run.id}`;
}
