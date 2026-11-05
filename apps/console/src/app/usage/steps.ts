import type {
  UsageKind,
  UsageMrData,
  UsageMrEntry,
  UsageTotals,
} from '@mattstack/rt-client';

export type StepRow =
  | {
      type: 'step';
      key: string;
      label: string;
      level: 'group' | 'child';
      kind: UsageKind;
      totals: UsageTotals;
    }
  | { type: 'elsewhere'; key: string; label: string };

function groupLabel(entry: UsageMrEntry): string {
  switch (entry.kind) {
    case 'work':
      return 'Work run';
    case 'review':
      return 'Your review';
    case 'respond':
      return entry.round !== null ? `Round ${entry.round}` : 'Response';
    case 'doctor':
      return 'Doctor';
    case 'other':
      return entry.pipeline ?? 'Other';
  }
}

function entryKey(entry: UsageMrEntry): string {
  return entry.runId ?? entry.sessionId ?? String(entry.firstActivity);
}

/** The MR's steps in order: each run as a heading row, a work run's stages
    under it, and under each round the review it answers, which ran on a
    teammate's Mac. */
export function stepRows(mr: UsageMrData): StepRow[] {
  return mr.runs.flatMap(entry => {
    const key = entryKey(entry);
    const group: StepRow = {
      type: 'step',
      key,
      label: groupLabel(entry),
      level: 'group',
      kind: entry.kind,
      totals: entry.totals,
    };
    if (entry.kind === 'respond') {
      return [
        group,
        {
          type: 'elsewhere',
          key: `${key}-teammate`,
          label: 'Teammate review',
        },
        {
          type: 'step',
          key: `${key}-response`,
          label: 'Your response',
          level: 'child',
          kind: entry.kind,
          totals: entry.totals,
        },
      ];
    }
    if (entry.kind !== 'work') return [group];
    return [
      group,
      ...entry.stages.map((stage): StepRow => ({
        type: 'step',
        key: `${key}-${stage.name}-${stage.attempt}`,
        label: stage.name
          ? `${stage.name}${stage.attempt && stage.attempt > 1 ? ` (attempt ${stage.attempt})` : ''}`
          : 'Outside stages',
        level: 'child',
        kind: entry.kind,
        totals: stage.totals,
      })),
    ];
  });
}
