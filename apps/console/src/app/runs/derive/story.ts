import type {
  GateRow,
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';
import {
  legacyItems,
  parseEvidence,
  type ParsedEvidence,
} from '@mattstack/rt-client/evidence';

import { fieldLabel, placeFields, storyFields } from './fields';
import { gateStage, pickedText, questionAnswer } from './gates';
import { answeredQuestionCount } from './record';
import { stageAttempts, type StageAttempt } from './stages';

export type StoryEvidence = 'before' | 'after' | 'legacy';

export interface StoryHold {
  from: number;
  to: number | null;
  reason: string | null;
}

export interface StoryEntry {
  key: string;
  attempt: StageAttempt;
  /** The stage name, with "· attempt N" when the stage ran more than once. */
  label: string;
  durationMs: number | null;
  fields: RunFieldRow[];
  /** Answered, closed and superseded gates placed at this attempt. */
  gates: GateRow[];
  holds: StoryHold[];
  failure: { reason: string | null; detailPath: string | null } | null;
  /** "back to implement: <reason>" for a redirected attempt. */
  redirect: string | null;
  evidence: StoryEvidence | null;
  /** The row that shows the evidence's url: the first phase the story
      places, so the link appears once. */
  evidenceUrl?: boolean;
}

export interface StoryInput {
  stages: RunStageRow[];
  fields: RunFieldRow[];
  decisions: RunDecisionRow[];
  gates: GateRow[];
  run: { status: string; ended_at: number | null };
  now: number;
}

export interface LiveStory {
  /** The attempt the run is in now; null once the run has ended. */
  current: StageAttempt | null;
  currentLabel: string | null;
  currentFields: RunFieldRow[];
  entries: StoryEntry[];
}

const keyOf = (a: { stage: string; attempt: number }) =>
  `${a.stage}#${a.attempt}`;

const SCOPED = /^(hold|redirect):([^:]+):(\d+)$/;

function selectionObject(selection: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(selection);
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

function redirectText(selection: string): string {
  const sel = selectionObject(selection);
  if (!sel) return selection;
  const to = str(sel.to);
  const reason = str(sel.reason);
  if (to && reason) return `back to ${to}: ${reason}`;
  if (to) return `back to ${to}`;
  return reason ?? selection;
}

function isSettled(g: GateRow): boolean {
  return g.status === 'answered' || g.status === 'closed';
}

/** The attempt a gate belongs to: its stage's attempt that had started when
    the gate opened, else that stage's last attempt, else the attempt whose
    window holds the opening. */
function attemptOfGate(
  g: GateRow,
  stages: RunStageRow[],
  attempts: StageAttempt[]
): StageAttempt | null {
  const stage = gateStage(g, stages);
  const own = attempts.filter(a => a.stage === stage);
  if (own.length > 0) {
    const started = own.filter(
      a => a.startedAt != null && a.startedAt <= g.openedAt
    );
    return started.at(-1) ?? own.at(-1)!;
  }
  const started = attempts.filter(
    a => a.startedAt != null && a.startedAt <= g.openedAt
  );
  return started.at(-1) ?? null;
}

function evidencePhases(value: string | undefined): StoryEvidence[] {
  const parsed = parseEvidence(value);
  if (parsed.version === 0) return ['legacy'];
  if (parsed.version !== 1) return [];
  const keys = new Set(parsed.images.map(i => i.key));
  const out: StoryEvidence[] = [];
  if (keys.has('before') || keys.has('beforeAnnotated')) out.push('before');
  if (keys.has('after') || keys.has('afterAnnotated')) out.push('after');
  return out;
}

function labelOf(a: StageAttempt, runsOfStage: number): string {
  return runsOfStage > 1 ? `${a.stage} · attempt ${a.attempt}` : a.stage;
}

function durationOf(a: StageAttempt, now: number): number | null {
  if (a.startedAt == null) return null;
  const end = a.endedAt ?? (a.status === 'running' ? now : null);
  return end == null ? null : Math.max(0, end - a.startedAt);
}

/** A work run's story: the attempt it is in now, with the fields written
    during it, and every other attempt that has something to tell, in run
    order. An attempt with no fields, decisions, holds, failure, redirect or
    evidence is left out. */
export function liveStory(input: StoryInput): LiveStory {
  const { stages, fields, decisions, gates, run, now } = input;
  const finished = run.status !== 'running';
  const attempts = stageAttempts(stages, run, now).map(a =>
    finished && a.status === 'running' ? { ...a, status: 'done' as const } : a
  );
  const placed = placeFields(storyFields(fields), attempts);
  const last = attempts.at(-1);
  const current =
    run.status === 'running' && last?.status === 'running' ? last : null;
  const runs = new Map<string, number>();
  for (const a of attempts) runs.set(a.stage, (runs.get(a.stage) ?? 0) + 1);
  const label = (a: StageAttempt) => labelOf(a, runs.get(a.stage) ?? 1);

  const gatesAt = new Map<string, GateRow[]>();
  for (const g of [...gates]
    .filter(isSettled)
    .sort((x, y) => x.openedAt - y.openedAt)) {
    const a = attemptOfGate(g, stages, attempts);
    if (!a) continue;
    const list = gatesAt.get(keyOf(a)) ?? [];
    list.push(g);
    gatesAt.set(keyOf(a), list);
  }

  const holds = new Map<string, StoryHold[]>();
  const redirects = new Map<string, string>();
  for (const d of decisions) {
    const m = SCOPED.exec(d.scope);
    if (!m) continue;
    const [, kind, stage, attempt] = m;
    const key = `${stage}#${attempt}`;
    if (kind === 'redirect') {
      redirects.set(key, redirectText(d.selection));
      continue;
    }
    const next = stages.find(
      s => s.name === stage && s.attempt === Number(attempt) + 1
    );
    const list = holds.get(key) ?? [];
    list.push({
      from: d.decided_at,
      to: next?.started_at ?? null,
      reason: str(selectionObject(d.selection)?.reason),
    });
    holds.set(key, list);
  }

  const story = attempts.filter(a => a !== current);
  const evidenceAt = new Map<string, StoryEvidence>();
  const evidenceField = fields.find(f => f.key === 'evidence');
  const placedAt = evidenceField
    ? story.findLast(
        a => a.startedAt != null && a.startedAt <= evidenceField.at
      )
    : undefined;
  for (const phase of evidencePhases(evidenceField?.value)) {
    const home = phase === 'after' ? 'ship' : 'evidence';
    const target =
      story.findLast(a => a.stage === home) ??
      (phase === 'after' ? undefined : placedAt);
    if (target && !evidenceAt.has(keyOf(target)))
      evidenceAt.set(keyOf(target), phase);
  }
  const urlAt = [...evidenceAt].find(([, phase]) => phase !== 'legacy')?.[0];

  const entries: StoryEntry[] = story.map(a => {
    const key = keyOf(a);
    const row = stages.find(s => s.name === a.stage && s.attempt === a.attempt);
    return {
      key,
      attempt: a,
      label: label(a),
      durationMs: durationOf(a, now),
      fields: placed.get(key) ?? [],
      gates: gatesAt.get(key) ?? [],
      holds: holds.get(key) ?? [],
      failure:
        a.status === 'failed'
          ? {
              reason: row?.reason ?? null,
              detailPath: row?.detail_path ?? null,
            }
          : null,
      redirect: a.status === 'redirected' ? (redirects.get(key) ?? null) : null,
      evidence: evidenceAt.get(key) ?? null,
      evidenceUrl: key === urlAt,
    };
  });

  return {
    current,
    currentLabel: current ? label(current) : null,
    currentFields: current ? (placed.get(keyOf(current)) ?? []) : [],
    entries: entries.filter(
      e =>
        e.fields.length > 0 ||
        e.gates.length > 0 ||
        e.holds.length > 0 ||
        e.failure !== null ||
        e.redirect !== null ||
        e.evidence !== null
    ),
  };
}

/** A one-stage run (review, respond, utility) as a single block: its last
    attempt with every story field and every settled gate on the run. */
export function runBlock(input: StoryInput): StoryEntry | null {
  const { stages, fields, gates, run, now } = input;
  const attempts = stageAttempts(stages, run, now);
  const a = attempts.at(-1);
  if (!a) return null;
  const finished = run.status !== 'running';
  const shown: StageAttempt =
    finished && a.status === 'running' ? { ...a, status: 'done' } : a;
  const row = stages.find(s => s.name === a.stage && s.attempt === a.attempt);
  return {
    key: keyOf(a),
    attempt: shown,
    label: a.stage,
    durationMs: durationOf(a, now),
    fields: storyFields(fields),
    gates: [...gates].filter(isSettled).sort((x, y) => x.openedAt - y.openedAt),
    holds: [],
    failure:
      a.status === 'failed'
        ? { reason: row?.reason ?? null, detailPath: row?.detail_path ?? null }
        : null,
    redirect: null,
    evidence: null,
  };
}

/** A stage row's one line: "3 decisions · <first pick>" when the attempt
    has answered questions, else its first field as "<Label>: <value>", else
    why it failed, else nothing. A stage that holds evidence says what it
    captured ("2 screenshots, 1 link") in place of the pick, which its
    opened body already shows. */
export function stageSummary(
  entry: StoryEntry,
  evidence: ParsedEvidence | null = null
): string {
  const count = answeredQuestionCount(entry.gates);
  const captured =
    entry.evidence && evidence
      ? evidenceSummary(evidence, entry.evidence, entry.evidenceUrl ?? false)
      : null;
  if (count > 0) {
    const detail = captured ?? firstPick(entry.gates);
    const head = `${count} ${count === 1 ? 'decision' : 'decisions'}`;
    return detail ? `${head} · ${detail}` : head;
  }
  if (captured) return captured;
  const field = entry.fields[0];
  if (field) return `${fieldLabel(field.key)}: ${oneLine(field.value)}`;
  return entry.failure?.reason ?? '';
}

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "2 screenshots, 1 link": what one phase of a run's evidence captured. */
function evidenceSummary(
  evidence: ParsedEvidence,
  phase: StoryEvidence,
  entryUrl: boolean
): string | null {
  let shots = 0;
  let links = 0;
  if (evidence.version === 0) {
    for (const item of legacyItems(evidence.links))
      if (item.kind === 'image') shots += 1;
      else links += 1;
  } else if (evidence.version === 1) {
    shots = evidence.images.filter(i => i.key.startsWith(phase)).length;
    if (entryUrl && evidence.evidence.url) links = 1;
  }
  const parts = [
    shots > 0 ? counted(shots, 'screenshot') : null,
    links > 0 ? counted(links, 'link') : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function firstPick(gates: GateRow[]): string | null {
  for (const g of gates) {
    if (g.status !== 'answered') continue;
    for (const q of g.questions) {
      const answer = questionAnswer(g.answer, q);
      if (!answer) continue;
      if (answer.picked.length > 0) return pickedText(q, answer.picked);
      if (answer.text) return oneLine(answer.text);
    }
  }
  return null;
}
