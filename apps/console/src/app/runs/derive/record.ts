import type {
  GateQuestion,
  GateRow,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';

import { isMine } from '../../../shared/gate-waiting';
import { contextSchema } from './answers';
import { formatClock } from './clock';
import { formatDuration } from './duration';
import { parseFinding, type ParsedFinding } from './findings';
import {
  gateStage,
  optionViews,
  pickedText,
  questionAnswer,
  tookRecommendation,
  waitingOnYou,
} from './gates';
import { stageAttempts, type StageAttempt } from './stages';

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

export type RecordTab = 'story' | 'decisions' | 'evidence' | 'inputs';

export function defaultRecordTab(gates: GateRow[]): RecordTab {
  return answeredGates(gates).length > 0 ? 'decisions' : 'story';
}

export interface DecisionStage {
  /** Null for gates no stage window holds. */
  stage: string | null;
  /** Answered, closed and superseded gates, oldest first. */
  gates: GateRow[];
  /** Answered questions, as every decision count on the record counts. */
  answered: number;
  /** The stage's attempts added up; null when it never ran. */
  durationMs: number | null;
  /** Answered questions here that went against their recommendation. */
  overrides: number;
  /** The stage's last attempt's status; null when it never ran. */
  status: StageAttempt['status'] | null;
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
      const tally = recommendationTally(list);
      return {
        stage,
        gates: list,
        answered: answeredQuestionCount(list),
        durationMs: spans.length > 0 ? spans.reduce((x, y) => x + y, 0) : null,
        overrides: tally.of - tally.took,
        status: own.at(-1)?.status ?? null,
      };
    });
}

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

/** The gate a review posts through: it asks for findings, or it is the
    `review-post` gate, whose `outcome` question is the verdict. */
const isPostingGate = (g: GateRow) =>
  g.kind === 'review-post' || g.questions.some(isFindingsQuestion);

interface ContextFinding {
  id?: unknown;
  severity?: unknown;
  title?: unknown;
  file?: unknown;
}

/** A findings context's entries by id; empty for prose or another schema. */
function contextFindings(
  context: string | null | undefined
): Map<string, ContextFinding> {
  const byId = new Map<string, ContextFinding>();
  if (contextSchema(context) !== FINDINGS_SCHEMA) return byId;
  const { findings } = JSON.parse(context!) as { findings?: unknown };
  if (!Array.isArray(findings)) return byId;
  for (const f of findings as (ContextFinding | null)[])
    if (f && typeof f.id === 'string') byId.set(f.id, f);
  return byId;
}

const SEVERITIES = ['critical', 'important', 'minor'] as const;

function findingOf(
  entry: ContextFinding | undefined,
  label: string
): ParsedFinding {
  if (typeof entry?.title !== 'string') return parseFinding(label);
  const tier =
    typeof entry.severity === 'string' ? entry.severity.toLowerCase() : null;
  return {
    severity: SEVERITIES.find(s => s === tier) ?? null,
    text: entry.title.trim(),
    where: typeof entry.file === 'string' && entry.file ? entry.file : null,
  };
}

const iidOf = (text: string) => /!(\d+)\b/.exec(text)?.[1] ?? null;

export interface ReviewVerdict {
  /** The verdict question's pick, "Request changes"; empty when none was
      answered. */
  verdict: string;
  /** The findings picked to post, across every findings question. */
  findings: ParsedFinding[];
  mrIid: string | null;
}

/** What a review posted: its verdict and the findings it picked, each read
    from its question's structured findings context, else from its option
    label. Null when the run answered no posting gate. */
export function reviewVerdict(gates: GateRow[]): ReviewVerdict | null {
  const posting = answeredGates(gates).filter(isPostingGate);
  if (posting.length === 0) return null;
  let verdict = '';
  const findings: ParsedFinding[] = [];
  let mrIid: string | null = null;
  for (const g of posting) {
    mrIid ??= iidOf(g.subject);
    for (const q of g.questions) {
      const answer = questionAnswer(g.answer, q);
      if (!answer) continue;
      if (isFindingsQuestion(q)) {
        mrIid ??= iidOf(q.label);
        const entries = contextFindings(q.context);
        const labels = new Map(optionViews(q).map(o => [o.value, o.text]));
        for (const v of answer.picked)
          findings.push(findingOf(entries.get(v), labels.get(v) ?? v));
      } else if (q.id === 'outcome') {
        verdict = pickedText(q, answer.picked);
      }
    }
  }
  return { verdict, findings, mrIid };
}

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
