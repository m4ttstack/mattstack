import type {
  UsageKind,
  UsageMrData,
  UsageMrEntry,
  UsageOutside,
  UsageStageRow,
  UsageTotals,
} from '@mattstack/rt-client';

import { daySpan } from './format';

export type StepRow =
  | {
      type: 'step';
      key: string;
      label: string;
      level: 'group' | 'child';
      kind: UsageKind;
      /** The line under the label: when, and how much was subagents. */
      note?: string;
      totals: UsageTotals;
    }
  | { type: 'elsewhere'; key: string; label: string };

const OUTSIDE_LABEL: Record<UsageOutside, string> = {
  before: 'Before the first stage',
  between: 'Between stages',
  after: 'After the last stage',
  none: 'No stages recorded',
};

function stageLabel(stage: UsageStageRow): string {
  if (stage.outside) return OUTSIDE_LABEL[stage.outside];
  const attempt =
    stage.attempt && stage.attempt > 1 ? ` (attempt ${stage.attempt})` : '';
  return `${stage.name}${attempt}`;
}

function outsideNote(stage: UsageStageRow): string | undefined {
  if (!stage.outside || stage.firstActivity === null) return undefined;
  const when = daySpan(stage.firstActivity, stage.lastActivity!);
  const share =
    stage.totals.cost > 0 ? stage.subagentCost / stage.totals.cost : 0;
  return share > 0 ? `${when}, ${Math.round(share * 100)}% subagents` : when;
}

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
        key: `${key}-${stage.name}-${stage.attempt}-${stage.outside}`,
        label: stageLabel(stage),
        note: outsideNote(stage),
        level: 'child',
        kind: entry.kind,
        totals: stage.totals,
      })),
    ];
  });
}
