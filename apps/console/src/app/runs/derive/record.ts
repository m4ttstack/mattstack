import type {
  GateRow,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';
import { parseEvidence } from '@mattstack/rt-client/evidence';

import { isMine } from '../../../shared/gate-waiting';
import { countCommits } from './answers';
import { formatClock } from './clock';
import { formatDuration } from './duration';
import { gateStage, tookRecommendation, waitingOnYou } from './gates';
import type { RunKind } from './kind';
import { stageAttempts } from './stages';

/** The run's answered gates: every decision count in the record. */
export const answeredGates = (gates: GateRow[]) =>
  gates.filter(g => g.status === 'answered' && g.answer);

/** The questions the run's answered gates have an answer for. */
export function answeredQuestionCount(gates: GateRow[]): number {
  let n = 0;
  for (const g of answeredGates(gates))
    for (const q of g.questions) if (g.answer!.answers[q.id] != null) n += 1;
  return n;
}

/** Where a finished run's span ends: at the merge of the run's own MR when
    the run finished done and the MR merged, else when the run ended. */
export function recordEnd(
  run: Pick<RunSummary, 'status' | 'ended_at' | 'last_event_at' | 'outcome'>,
  now: number
): { at: number; merged: boolean } {
  const mr = run.outcome?.mr;
  if (run.status === 'done' && mr?.state === 'merged' && mr.mergedAt != null)
    return { at: mr.mergedAt, merged: true };
  return { at: run.ended_at ?? run.last_event_at ?? now, merged: false };
}

const dayOf = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** "Oct 8, 11:42 AM → 2:14 PM", naming the end's day only when it differs. */
export function recordSpan(from: number, to: number): string {
  const start = `${dayOf(from)}, ${formatClock(from)}`;
  const sameDay = new Date(from).toDateString() === new Date(to).toDateString();
  return `${start} → ${sameDay ? '' : `${dayOf(to)}, `}${formatClock(to)}`;
}

/** Of the answered questions that named a recommendation, how many took
    it. */
export function recommendationTally(gates: GateRow[]): {
  took: number;
  of: number;
} {
  let took = 0;
  let of = 0;
  for (const g of answeredGates(gates)) {
    for (const q of g.questions) {
      const t = tookRecommendation(q, g.answer);
      if (t === null) continue;
      of += 1;
      if (t) took += 1;
    }
  }
  return { took, of };
}

/** The evidence stat: the image count, "<n> links" for legacy evidence, or
    null when the run recorded none. */
export function evidenceStat(value: string | undefined): string | null {
  const parsed = parseEvidence(value);
  if (parsed.version === 1)
    return parsed.images.length > 0 ? String(parsed.images.length) : null;
  if (parsed.version === 0 && parsed.links.length > 0)
    return `${parsed.links.length} ${parsed.links.length === 1 ? 'link' : 'links'}`;
  return null;
}

export type RecordStatId =
  'duration' | 'decisions' | 'took' | 'evidence' | 'commits' | 'waiting';

export interface RecordStat {
  id: RecordStatId;
  value: string;
  label: string;
}

export interface RecordStatsInput {
  run: RunSummary;
  kind: RunKind;
  gates: GateRow[];
  fields: RunFieldRow[];
  now: number;
}

/** The record header's numbers, each only where it applies to the run. */
export function recordStats({
  run,
  kind,
  gates,
  fields,
  now,
}: RecordStatsInput): RecordStat[] {
  const field = (key: string) => fields.find(f => f.key === key)?.value;
  const end = recordEnd(run, now);
  const stats: RecordStat[] = [
    {
      id: 'duration',
      value: formatDuration(end.at - run.started_at),
      label: end.merged ? 'start to merge' : 'start to end',
    },
  ];
  const decided = answeredGates(gates).length;
  if (decided > 0)
    stats.push({ id: 'decisions', value: String(decided), label: 'decisions' });
  const tally = recommendationTally(gates);
  if (tally.of > 0)
    stats.push({
      id: 'took',
      value: `${tally.took} of ${tally.of}`,
      label: 'took the recommendation',
    });
  if (kind === 'work') {
    const evidence = evidenceStat(field('evidence'));
    if (evidence)
      stats.push({ id: 'evidence', value: evidence, label: 'evidence' });
    const commits = countCommits(field('commits') ?? null);
    if (commits > 0)
      stats.push({ id: 'commits', value: String(commits), label: 'commits' });
  }
  const waited = waitingOnYou(gates.filter(isMine), end.at);
  if (waited > 0)
    stats.push({
      id: 'waiting',
      value: formatDuration(waited),
      label: 'waiting on you',
    });
  return stats;
}

export type RecordTab = 'story' | 'decisions' | 'evidence' | 'inputs';

export function defaultRecordTab(gates: GateRow[]): RecordTab {
  return answeredGates(gates).length > 0 ? 'decisions' : 'story';
}

export interface DecisionStage {
  /** Null for gates no stage window holds. */
  stage: string | null;
  /** Answered, closed and superseded gates, oldest first. */
  gates: GateRow[];
  answered: number;
  /** The stage's attempts added up; null when it never ran. */
  durationMs: number | null;
  /** Some answer here went against its recommendation. */
  overrode: boolean;
}

/** Whether the record has any decision log to show. */
export const hasSettledGates = (gates: GateRow[]) =>
  gates.some(g => g.status === 'answered' || g.status === 'closed');

/** The decision log's groups: each stage's settled gates, in the pipeline's
    stage order, then stages the pipeline does not name in run order. */
export function decisionStages(
  gates: GateRow[],
  stages: RunStageRow[],
  run: { status: string; ended_at: number | null },
  now: number,
  pipelineStages: string | null
): DecisionStage[] {
  const attempts = stageAttempts(stages, run, now);
  const settled = gates
    .filter(g => g.status === 'answered' || g.status === 'closed')
    .sort((a, b) => a.openedAt - b.openedAt);
  const groups = new Map<string | null, GateRow[]>();
  for (const g of settled) {
    const stage = gateStage(g, stages);
    groups.set(stage, [...(groups.get(stage) ?? []), g]);
  }
  const pipeline = (pipelineStages ?? '').split(/\s+/).filter(Boolean);
  const runOrder = attempts.map(a => a.stage);
  const rank = (stage: string | null) => {
    if (stage === null) return Infinity;
    const p = pipeline.indexOf(stage);
    if (p >= 0) return p;
    const r = runOrder.indexOf(stage);
    return pipeline.length + (r >= 0 ? r : runOrder.length);
  };
  return [...groups.entries()]
    .sort(
      ([a, ga], [b, gb]) =>
        rank(a) - rank(b) || ga[0]!.openedAt - gb[0]!.openedAt
    )
    .map(([stage, list]) => {
      const own = attempts.filter(a => a.stage === stage);
      const spans = own
        .filter(a => a.startedAt != null && a.endedAt != null)
        .map(a => a.endedAt! - a.startedAt!);
      return {
        stage,
        gates: list,
        answered: answeredGates(list).length,
        durationMs: spans.length > 0 ? spans.reduce((x, y) => x + y, 0) : null,
        overrode: answeredGates(list).some(g =>
          g.questions.some(q => tookRecommendation(q, g.answer) === false)
        ),
      };
    });
}

/** A posted disposition as the outcome badge says it: "Request changes". */
export function postedLabel(posted: string): string {
  const words = posted.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const flat = words === words.toUpperCase() ? words.toLowerCase() : words;
  return flat.charAt(0).toUpperCase() + flat.slice(1);
}
