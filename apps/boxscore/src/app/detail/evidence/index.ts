import { createElement, type ComponentType } from 'react';

import { METRICS } from '../../../shared/metrics';
import type {
  MetricEvidence,
  MetricKey,
  TimeWindow,
  UserRow,
} from '../../../shared/types';
import { CodingDaysEvidence } from './CodingDaysEvidence';
import { IssuesEvidence } from './IssuesEvidence';
import { LatencyEvidence } from './LatencyEvidence';
import { EmptyEvidence } from './parts';
import { PipelinesEvidence } from './PipelinesEvidence';
import { ReciprocityEvidence } from './ReciprocityEvidence';

export interface EvidenceProps {
  ev: MetricEvidence;
  users: UserRow[];
  username: string;
  statKey: MetricKey;
  window: TimeWindow;
}

const Unmapped: ComponentType<EvidenceProps> = () =>
  createElement(EmptyEvidence);

const PANELS: Partial<Record<MetricKey, ComponentType<EvidenceProps>>> = {
  issuesCompleted: IssuesEvidence,
  reviewLatencyHours: LatencyEvidence,
  responseLatencyHours: LatencyEvidence,
  codingDays: CodingDaysEvidence,
  pipelines: PipelinesEvidence,
  reciprocity: ReciprocityEvidence,
};

export const EVIDENCE: Record<
  MetricKey,
  ComponentType<EvidenceProps>
> = Object.fromEntries(
  METRICS.map(d => [d.key, PANELS[d.key] ?? Unmapped])
) as Record<MetricKey, ComponentType<EvidenceProps>>;
