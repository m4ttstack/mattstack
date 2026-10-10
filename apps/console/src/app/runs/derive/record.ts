import type {
  GateQuestion,
  GateRow,
  RunFieldRow,
  RunSummary,
} from '@mattstack/rt-client';

import { isMine } from '../../../shared/gate-waiting';
import { contextSchema } from './answers';
import { formatClock } from './clock';
import { formatDuration } from './duration';
import { tookRecommendation, waitingOnYou } from './gates';

/** The run's answered gates. */
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

export type RecordStatId = 'duration' | 'decisions' | 'took' | 'waiting';

export interface RecordStat {
  id: RecordStatId;
  value: string;
  label: string;
}

export interface RecordStatsInput {
  run: RunSummary;
  gates: GateRow[];
  now: number;
}

/** The record header's numbers, each only where it applies to the run. */
export function recordStats({
  run,
  gates,
  now,
}: RecordStatsInput): RecordStat[] {
  const end = recordEnd(run, now);
  const stats: RecordStat[] = [
    {
      id: 'duration',
      value: formatDuration(end.at - run.started_at),
      label: end.merged ? 'start to merge' : 'start to end',
    },
  ];
  const decided = answeredQuestionCount(gates);
  if (decided > 0)
    stats.push({
      id: 'decisions',
      value: String(decided),
      label: decided === 1 ? 'decision' : 'decisions',
    });
  const tally = recommendationTally(gates);
  if (tally.of > 0)
    stats.push({
      id: 'took',
      value: `${tally.took} of ${tally.of}`,
      label: 'took the recommendation',
    });
  const waited = waitingOnYou(gates.filter(isMine), end.at);
  if (waited > 0)
    stats.push({
      id: 'waiting',
      value: formatDuration(waited),
      label: 'waiting on you',
    });
  return stats;
}

/** “Superseded by WEB-430”: the reason `rt runs abandon` noted. The hero
    already says the run was abandoned, and the note's time is the run's
    end, so the reason is all that is new. Null when the run was not
    abandoned or the reason is blank. */
export function abandonReason(
  run: Pick<RunSummary, 'status'>,
  fields: RunFieldRow[]
): string | null {
  if (run.status !== 'abandoned') return null;
  const reason = fields.find(f => f.key === 'reconciled')?.value.trim();
  return reason ? `“${reason}”` : null;
}

export type RecordTab = 'story' | 'evidence' | 'inputs';

/** A posted disposition as the outcome badge says it: "Request changes". */
export function postedLabel(posted: string): string {
  const words = posted.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const flat = words === words.toUpperCase() ? words.toLowerCase() : words;
  return flat.charAt(0).toUpperCase() + flat.slice(1);
}

const FINDINGS_SCHEMA = 'findings@1';

/** A question asking which findings to post: its context names the findings
    schema, or the review skill numbered it `findings-N`. */
const isFindingsQuestion = (q: GateQuestion) =>
  contextSchema(q.context) === FINDINGS_SCHEMA || /^findings-\d+$/.test(q.id);

/** A review's gates as its decision log lists them: the findings questions
    the verdict already shows, and a gate context that only lists them, left
    out; a gate left with no question is dropped. */
export function reviewDecisionGates(gates: GateRow[]): GateRow[] {
  return gates.flatMap(g => {
    const questions = g.questions.filter(q => !isFindingsQuestion(q));
    if (questions.length === 0 && g.questions.length > 0) return [];
    const context =
      contextSchema(g.context) === FINDINGS_SCHEMA ? null : g.context;
    return [{ ...g, questions, context }];
  });
}
