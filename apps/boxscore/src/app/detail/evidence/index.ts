import { createElement, type ComponentType } from 'react';

import { METRICS } from '../../../shared/metrics';
import type {
  MetricEvidence,
  MetricKey,
  TimeWindow,
  UserRow,
} from '../../../shared/types';
import { CodingDaysEvidence } from './CodingDaysEvidence';
import { DepthEvidence } from './DepthEvidence';
import { IssuesEvidence } from './IssuesEvidence';
import { LatencyEvidence } from './LatencyEvidence';
import { MergedMrsEvidence, type MergedSort } from './MergedMrsEvidence';
import { EmptyEvidence } from './parts';
import { PipelinesEvidence } from './PipelinesEvidence';
import { ReciprocityEvidence } from './ReciprocityEvidence';
import { RevertEvidence } from './RevertEvidence';
import { ReviewsEvidence } from './ReviewsEvidence';
import { SizeEvidence } from './SizeEvidence';
import { StreakEvidence } from './StreakEvidence';

export interface EvidenceProps {
  ev: MetricEvidence;
  users: UserRow[];
  username: string;
  statKey: MetricKey;
  window: TimeWindow;
}

const Unmapped: ComponentType<EvidenceProps> = () =>
  createElement(EmptyEvidence);

/** Added and Deleted open the merged list sorted by their own column. */
const sortedBy = (initialSort: MergedSort): ComponentType<EvidenceProps> =>
  function SortedMergedMrs(props: EvidenceProps) {
    return createElement(MergedMrsEvidence, { ...props, initialSort });
  };

const PANELS: Partial<Record<MetricKey, ComponentType<EvidenceProps>>> = {
  issuesCompleted: IssuesEvidence,
  reviewLatencyHours: LatencyEvidence,
  responseLatencyHours: LatencyEvidence,
  codingDays: CodingDaysEvidence,
  pipelines: PipelinesEvidence,
  reciprocity: ReciprocityEvidence,
  mrsMerged: sortedBy('newest'),
  additions: sortedBy('most-added'),
  deletions: sortedBy('most-deleted'),
  sizeHealthPct: SizeEvidence,
  revertRate: RevertEvidence,
  revertedCount: RevertEvidence,
  mrsReviewed: ReviewsEvidence,
  reviewDepth: DepthEvidence,
  longestStreak: StreakEvidence,
  currentStreak: StreakEvidence,
};

export const EVIDENCE: Record<
  MetricKey,
  ComponentType<EvidenceProps>
> = Object.fromEntries(
  METRICS.map(d => [d.key, PANELS[d.key] ?? Unmapped])
) as Record<MetricKey, ComponentType<EvidenceProps>>;
