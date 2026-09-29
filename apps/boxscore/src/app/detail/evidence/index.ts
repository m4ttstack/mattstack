import { createElement, type ComponentType } from 'react';

import { METRICS } from '../../../shared/metrics';
import type {
  MetricEvidence,
  MetricKey,
  TimeWindow,
  UserRow,
} from '../../../shared/types';
import { IssuesEvidence } from './IssuesEvidence';
import { EmptyEvidence } from './parts';

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
};

export const EVIDENCE: Record<
  MetricKey,
  ComponentType<EvidenceProps>
> = Object.fromEntries(
  METRICS.map(d => [d.key, PANELS[d.key] ?? Unmapped])
) as Record<MetricKey, ComponentType<EvidenceProps>>;
