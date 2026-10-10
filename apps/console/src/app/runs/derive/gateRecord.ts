import type { GateQuestion, GateRow } from '@mattstack/rt-client';

import { type FindingSeverity } from './findings';
import { optionViews, questionAnswer } from './gates';

/** One option of an answered question, as the record draws it. */
export interface RecordOption {
  value: string;
  text: string;
  picked: boolean;
  /** The option's own one-liner; drawn under a picked option only. */
  detail?: string;
}

export interface RecordQuestion {
  id: string;
  label: string;
  multi: boolean;
  options: RecordOption[];
  note?: string;
  text?: string;
}

/** A gate drawn as the form that was answered: every option, picks checked. */
export interface FormRecord {
  shape: 'form';
  /** The agent's prose context for the whole ask. */
  summary: string | null;
  /** The agent hit a wall and asks how to go on. */
  escalation: boolean;
  questions: RecordQuestion[];
  /** The picked "Next?" or "Then?" move, folded out of the questions. */
  then: string | null;
}

export interface RecordFinding {
  id: string;
  severity: FindingSeverity | null;
  title: string;
  where: string | null;
  posted: boolean;
}

export interface RecordThread {
  where: string;
  gist: string;
  replied: boolean;
  resolved: boolean;
}

/** A review run's post gate: the verdict, findings, carried-over threads. */
export interface ReviewPostRecord {
  shape: 'review-post';
  verdict: { pick: string; reason: string | null; passed: string[] } | null;
  findings: RecordFinding[];
  threads: RecordThread[];
  /** Findings skipped in an earlier round that stay skipped. */
  skipped: number;
  /** Skipped findings brought back this round. */
  restored: number;
}

export interface RespondThread {
  where: string;
  severity: string | null;
  claim: string;
  call: string | null;
  callNote: string | null;
  pick: string | null;
  note?: string;
}

/** A receive-review run's plan gate: each reviewer thread and your call. */
export interface RespondPlanRecord {
  shape: 'respond-plan';
  reviewer: string | null;
  threads: RespondThread[];
  codeChanges: { pick: string; passed: string[] } | null;
}

export interface RespondReply {
  where: string;
  text: string;
  sha: string | null;
  posted: boolean;
  resolved: boolean;
}

/** A receive-review run's post gate: the replies that went up. */
export interface RespondPostRecord {
  shape: 'respond-post';
  replies: RespondReply[];
}

export type GateRecord =
  FormRecord | ReviewPostRecord | RespondPlanRecord | RespondPostRecord;

const CONTROL_IDS = new Set(['next']);
const CONTROL_LABEL = /^(next|then|next move)\?$/i;

function isControl(q: GateQuestion): boolean {
  return CONTROL_IDS.has(q.id) || CONTROL_LABEL.test(q.label.trim());
}

function parseObject(
  text: string | null | undefined
): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

function recordQuestion(gate: GateRow, q: GateQuestion): RecordQuestion {
  const answer =
    gate.status === 'answered' ? questionAnswer(gate.answer, q) : null;
  const picked = new Set(answer?.picked ?? []);
  const options = optionViews(q).map((o, i) => {
    const raw = q.options[i];
    const detail = typeof raw === 'string' ? undefined : str(raw?.description);
    return {
      value: o.value,
      text: o.text,
      picked: picked.has(o.value),
      ...(detail ? { detail } : {}),
    };
  });
  return {
    id: q.id,
    label: q.label,
    multi: q.multi,
    options,
    ...(answer?.note ? { note: answer.note } : {}),
    ...(answer?.text ? { text: answer.text } : {}),
  };
}

export function formRecord(gate: GateRow): FormRecord {
  const control = gate.questions.find(isControl);
  const thenPick = control
    ? recordQuestion(gate, control)
        .options.filter(o => o.picked)
        .map(o => o.text)
    : [];
  const prose =
    gate.context && !parseObject(gate.context) ? gate.context : null;
  return {
    shape: 'form',
    summary: prose,
    escalation: /escalation$|^off-script/.test(gate.kind),
    questions: gate.questions
      .filter(q => q !== control && q.options.length > 0)
      .map(q => recordQuestion(gate, q)),
    then: thenPick.length ? thenPick.join(', ') : null,
  };
}

const SEVERITIES = new Set(['critical', 'important', 'minor']);
const severityOf = (v: unknown): FindingSeverity | null =>
  typeof v === 'string' && SEVERITIES.has(v.toLowerCase())
    ? (v.toLowerCase() as FindingSeverity)
    : null;

const shortWhere = (path: string) => {
  const at = path.lastIndexOf('/');
  return at === -1 ? path : path.slice(at + 1);
};

const picksOf = (gate: GateRow, q: GateQuestion) =>
  gate.status === 'answered'
    ? (questionAnswer(gate.answer, q)?.picked ?? [])
    : [];

function reviewPost(gate: GateRow): ReviewPostRecord | null {
  const out: ReviewPostRecord = {
    shape: 'review-post',
    verdict: null,
    findings: [],
    threads: [],
    skipped: 0,
    restored: 0,
  };
  for (const q of gate.questions) {
    const ctx = parseObject(q.context);
    const schema = str(ctx?.['gate-ctx']);
    const picked = new Set(picksOf(gate, q));
    if (schema === 'findings@1' && Array.isArray(ctx?.findings)) {
      for (const f of ctx.findings as Record<string, unknown>[]) {
        const id = str(f.id);
        if (!id) continue;
        const file = str(f.file);
        out.findings.push({
          id,
          severity: severityOf(f.severity),
          title: str(f.title) ?? id,
          where: file ? shortWhere(file) : null,
          posted: picked.has(id),
        });
      }
    } else if (schema === 'carryover@1') {
      const values = [...picked];
      out.threads.push({
        where: shortWhere(q.label),
        gist:
          str(ctx?.original)
            ?.replace(/\*\*[^*]+\*\*\s*/g, '')
            .split('\n')[0] ?? q.label,
        replied: values.some(v => v.startsWith('post:')),
        resolved: values.some(v => v.startsWith('resolve:')),
      });
    } else if (schema === 'skipped@1') {
      const list = Array.isArray(ctx?.skipped)
        ? ctx.skipped.length
        : q.options.length;
      out.restored += picked.size;
      out.skipped += list - picked.size;
    } else if (q.id === 'outcome' || /^verdict\b/i.test(q.label)) {
      const views = optionViews(q);
      const pick = views.filter(o => picked.has(o.value)).map(o => o.text);
      const reason = q.label.match(/^verdict on [^:]+:\s*(.+)$/i)?.[1] ?? null;
      out.verdict = {
        pick: pick.join(', '),
        reason: reason
          ? reason.charAt(0).toUpperCase() + reason.slice(1)
          : null,
        passed: views.filter(o => !picked.has(o.value)).map(o => o.text),
      };
      if (!pick.length) out.verdict = null;
    } else {
      return null;
    }
  }
  return out;
}

function respondPlan(gate: GateRow): RespondPlanRecord | null {
  const out: RespondPlanRecord = {
    shape: 'respond-plan',
    reviewer: str(parseObject(gate.context)?.reviewer),
    threads: [],
    codeChanges: null,
  };
  for (const q of gate.questions) {
    const ctx = parseObject(q.context);
    const views = optionViews(q);
    const answer =
      gate.status === 'answered' ? questionAnswer(gate.answer, q) : null;
    const picked = new Set(answer?.picked ?? []);
    const pick =
      views
        .filter(o => picked.has(o.value))
        .map(o => o.text)
        .join(', ') || null;
    if (str(ctx?.['gate-ctx']) === 'thread@1') {
      const claim = asObject(ctx?.claim);
      const verdict = asObject(ctx?.verdict);
      out.threads.push({
        where: shortWhere(q.label),
        severity: str(ctx?.severity),
        claim: str(claim?.summary) ?? q.label,
        call: str(verdict?.call),
        callNote: str(verdict?.note),
        pick,
        ...(answer?.note ? { note: answer.note } : {}),
      });
    } else if (q.id === 'code-changes') {
      if (pick)
        out.codeChanges = {
          pick,
          passed: views.filter(o => !picked.has(o.value)).map(o => o.text),
        };
    } else {
      return null;
    }
  }
  return out;
}

function respondPost(gate: GateRow): RespondPostRecord | null {
  const out: RespondPostRecord = { shape: 'respond-post', replies: [] };
  for (const q of gate.questions) {
    const ctx = parseObject(q.context);
    if (str(ctx?.['gate-ctx']) !== 'reply@1') return null;
    const values = picksOf(gate, q);
    out.replies.push({
      where: shortWhere(str(ctx?.file) ?? q.label),
      text: str(ctx?.text) ?? '',
      sha: str(ctx?.sha),
      posted: values.some(v => v.startsWith('post:')),
      resolved: values.some(v => v.startsWith('resolve:')),
    });
  }
  return out;
}

/** How a gate reads in its stage: a review's or a reply's own shape when
    its context carries one, else the answered form. A closed gate and any
    context that does not parse read as the form. */
export function gateRecord(gate: GateRow): GateRecord {
  if (gate.status === 'answered') {
    const special =
      gate.kind === 'review-post'
        ? reviewPost(gate)
        : gate.kind === 'respond-plan'
          ? respondPlan(gate)
          : gate.kind === 'respond-post'
            ? respondPost(gate)
            : null;
    if (special) return special;
  }
  return formRecord(gate);
}
