import type { GateAnswer, GateQuestion } from "../../packages/rt-client/src/commands.ts";
import type { GateCtxSource } from "./ctx.ts";

export type AnswerWire = GateAnswer["answers"][string];
export type AnswersMap = Record<string, AnswerWire>;

export interface DecisionRow {
  contract: string;
  scope: string;
  selection: string;
  decided_by: string;
  decided_at: number;
}

export type RecordShape = "answers" | "respond-plan" | "respond-post" | "post";

function isWriteIn(a: AnswerWire): a is { writeIn: string } {
  return typeof a === "object" && !Array.isArray(a) && "writeIn" in a;
}

export function normalizeAnswers(a: AnswersMap): AnswersMap {
  const out: AnswersMap = {};
  for (const [q, v] of Object.entries(a)) {
    if (typeof v !== "object" || Array.isArray(v) || isWriteIn(v)) {
      out[q] = v;
      continue;
    }
    const obj: { value: string | string[]; note?: string; text?: string } = { value: v.value };
    if (v.note) obj.note = v.note;
    if (v.text) obj.text = v.text;
    out[q] = obj.note || obj.text ? obj : v.value;
  }
  return out;
}

export function answerValue(a: AnswerWire): string | string[] | undefined {
  if (typeof a === "string" || Array.isArray(a)) return a;
  if (isWriteIn(a)) return undefined;
  return a.value;
}

export function splitVerb(value: string): { verb: string; id: string } {
  const i = value.indexOf(":");
  return i < 0 ? { verb: value, id: "" } : { verb: value.slice(0, i), id: value.slice(i + 1) };
}

export function writeInsOf(a: AnswersMap): { question: string; text: string }[] {
  const out: { question: string; text: string }[] = [];
  for (const [question, v] of Object.entries(a)) {
    if (isWriteIn(v)) out.push({ question, text: v.writeIn });
  }
  return out;
}

export function nextOf(a: AnswersMap): string | null {
  const v = a.next === undefined ? undefined : answerValue(a.next);
  return typeof v === "string" ? v : null;
}

export function actOnWriteIn(a: AnswersMap): boolean {
  if (writeInsOf(a).length === 0) return false;
  const next = nextOf(a);
  return next === null || next === "proceed" || next.startsWith("iterate");
}

export function decisionForGate(decisions: DecisionRow[], scope: string, since: number): DecisionRow | null {
  return decisions.find((d) => d.contract === "gate@1" && d.scope === scope && d.decided_at >= since) ?? null;
}

export function skipReason(shape: RecordShape, a: AnswersMap): string | null {
  if (shape === "answers") return null;
  const next = nextOf(a);
  return next !== null && next !== "proceed" ? `next is ${next}: ${shape} decides nothing` : null;
}

type Obj = Record<string, unknown>;
interface AnyQuestion { id?: unknown; label?: unknown; options?: unknown; context?: unknown }

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

function valuesOf(a: AnswerWire | undefined): string[] {
  const v = a === undefined ? undefined : answerValue(a);
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
}

function extraOf(a: AnswerWire | undefined, key: "text" | "note"): string | undefined {
  if (!isObj(a) || isWriteIn(a as AnswerWire)) return undefined;
  const v = (a as Obj)[key];
  return nonEmpty(v) ? v : undefined;
}

function questionsOf(source: GateCtxSource | undefined): AnyQuestion[] {
  return (source?.questions ?? []).filter(isObj) as AnyQuestion[];
}

function findQuestion(qs: AnyQuestion[] | undefined, id: string): AnyQuestion | undefined {
  return qs?.find((q) => q.id === id);
}

function optionsOf(q: AnyQuestion | undefined): unknown[] {
  return Array.isArray(q?.options) ? q.options : [];
}

function optionValueOf(o: unknown): string | undefined {
  if (typeof o === "string") return o;
  return isObj(o) && typeof o.value === "string" ? o.value : undefined;
}

function ctxOf(q: AnyQuestion | undefined, shape: string): Obj | undefined {
  return isObj(q?.context) && q.context["gate-ctx"] === shape ? q.context : undefined;
}

function recommendedVerb(q: AnyQuestion | undefined): string {
  for (const o of optionsOf(q)) {
    if (!isObj(o)) continue;
    const label = typeof o.label === "string" ? o.label : "";
    if (o.recommended === true || /\(recommended\)$/i.test(label)) {
      const v = optionValueOf(o);
      if (v !== undefined) return splitVerb(v).verb;
    }
  }
  return "unknown";
}

export interface PlanRow {
  threadId: string;
  file: string;
  verdict: string;
  recommended: string;
  gate1: "reply" | "fix" | "skip" | "override";
  reply: string;
}

export function respondPlanSelection(
  a: AnswersMap,
  o: { source?: GateCtxSource; storedQuestions?: GateQuestion[]; contextDropped?: boolean | string[] },
): { selection: Record<string, unknown>; rows: PlanRow[] } {
  const sourceQs = o.source ? questionsOf(o.source) : undefined;
  const storedQs = o.storedQuestions as AnyQuestion[] | undefined;
  const threads: Record<string, string> = {};
  const texts: Record<string, string> = {};
  const overrides: string[] = [];
  const notes: Record<string, string> = {};
  const rows: PlanRow[] = [];

  const dropped = (qid: string, sourceQ: AnyQuestion | undefined): boolean => {
    if (o.contextDropped === true) return true;
    if (Array.isArray(o.contextDropped) && o.contextDropped.includes(qid)) return true;
    if (sourceQ?.context === undefined || storedQs === undefined) return false;
    const stored = findQuestion(storedQs, qid);
    return stored === undefined || stored.context === undefined || stored.context === null || stored.context === "";
  };

  for (const qid of numberedKeys(a as unknown as Obj, "thread")) {
    const answer = a[qid];
    const [value] = valuesOf(answer);
    if (value === undefined) continue;
    const { verb, id } = splitVerb(value);
    threads[id] = verb;

    const sourceQ = findQuestion(sourceQs, qid);
    const card = ctxOf(sourceQ, "thread@1");
    const cardReply = isObj(card?.reply) ? card.reply : undefined;
    const text = verb === "reply" ? extraOf(answer, "text") : undefined;
    const note = extraOf(answer, "note");
    if (text !== undefined) texts[id] = text;

    const override =
      verb === "reply" &&
      text === undefined &&
      (cardReply === undefined || cardReply.kind !== "verbatim" || note !== undefined || dropped(qid, sourceQ));
    if (override) {
      overrides.push(id);
      if (note !== undefined) notes[id] = note;
    }

    const shownQ = sourceQ ?? findQuestion(storedQs, qid);
    const verdict = isObj(card?.verdict) ? card.verdict.call : undefined;
    const draft = cardReply && cardReply.kind !== "none" && typeof cardReply.text === "string" ? cardReply.text : undefined;
    rows.push({
      threadId: id,
      file: typeof shownQ?.label === "string" ? shownQ.label : "unknown",
      verdict: typeof verdict === "string" ? verdict : "unknown",
      recommended: recommendedVerb(shownQ),
      gate1: override ? "override" : (verb as PlanRow["gate1"]),
      reply: text ?? draft ?? "none",
    });
  }

  const selection: Record<string, unknown> = { threads };
  if (Object.keys(texts).length > 0) selection.texts = texts;
  if (overrides.length > 0) selection.overrides = overrides;
  if (Object.keys(notes).length > 0) selection.notes = notes;
  const codeChanges = a["code-changes"] === undefined ? undefined : answerValue(a["code-changes"]);
  if (codeChanges !== undefined) selection["code-changes"] = codeChanges;
  return { selection, rows };
}

function threadIdsOf(q: AnyQuestion | undefined, verbs: string[]): string[] {
  const ids: string[] = [];
  for (const opt of optionsOf(q)) {
    const v = optionValueOf(opt);
    if (v === undefined) continue;
    const { verb, id } = splitVerb(v);
    if (verbs.includes(verb) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function respondPostSelection(
  a: AnswersMap,
  o: { source?: GateCtxSource; storedQuestions?: GateQuestion[]; held?: string[] },
): Record<string, unknown> {
  if (Object.keys(a).some((k) => k === "replies" || /^replies-\d+$/.test(k))) return a;

  const offeredBy = new Map<string, string[]>();
  if (o.source) {
    for (const q of questionsOf(o.source)) {
      const card = ctxOf(q, "reply@1");
      if (typeof q.id === "string" && card && typeof card.thread === "string") offeredBy.set(q.id, [card.thread]);
    }
  } else {
    for (const q of (o.storedQuestions ?? []) as AnyQuestion[]) {
      const ids = threadIdsOf(q, ["post", "resolve"]);
      if (typeof q.id === "string" && ids.length > 0) offeredBy.set(q.id, ids);
    }
  }

  const threads: Record<string, Obj> = {};
  for (const ids of offeredBy.values()) for (const id of ids) threads[id] = { post: false, resolve: false };

  for (const [qid, answer] of Object.entries(a)) {
    if (qid === "next") continue;
    const picks = valuesOf(answer).map(splitVerb).filter((p) => p.verb === "post" || p.verb === "resolve");
    const named = [...new Set(picks.map((p) => p.id))];
    const ids = named.length > 0 ? named : (offeredBy.get(qid) ?? []);
    const text = extraOf(answer, "text");
    const note = extraOf(answer, "note");
    for (const id of ids) {
      const post = picks.some((p) => p.verb === "post" && p.id === id);
      const resolve = picks.some((p) => p.verb === "resolve" && p.id === id);
      const entry: Obj = { post, resolve };
      if (text !== undefined && post) entry.text = text;
      if (note !== undefined) entry.note = note;
      threads[id] = entry;
    }
  }

  const selection: Record<string, unknown> = { threads };
  if (o.held && o.held.length > 0) selection.held = o.held;
  return selection;
}

function numberedKeys(a: Obj, prefix: string): string[] {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  return Object.keys(a)
    .filter((k) => re.test(k))
    .sort((x, y) => Number(x.slice(prefix.length + 1)) - Number(y.slice(prefix.length + 1)));
}

export function postSelection(a: AnswersMap, o: { source?: GateCtxSource }): Record<string, unknown> {
  const raw = a as unknown as Obj;
  const outcome = a.outcome === undefined ? undefined : answerValue(a.outcome);

  if (Array.isArray(raw.findings)) {
    const handed: Record<string, unknown> = { findings: raw.findings, disposition: outcome };
    if (raw.replies !== undefined) handed.replies = raw.replies;
    if (raw.restored !== undefined) handed.restored = raw.restored;
    return handed;
  }
  if (a.tiers !== undefined) return { levels: answerValue(a.tiers), disposition: outcome };

  const findings: string[] = [];
  for (const k of numberedKeys(raw, "findings")) {
    for (const v of valuesOf(a[k])) if (!findings.includes(v)) findings.push(v);
  }
  const selection: Record<string, unknown> = { findings, disposition: outcome };

  const qs = questionsOf(o.source);
  const replies: Obj[] = [];
  for (const k of numberedKeys(raw, "thread")) {
    const picks = valuesOf(a[k]).map(splitVerb).filter((p) => p.verb === "post" || p.verb === "resolve");
    const text = extraOf(a[k], "text");
    for (const id of [...new Set(picks.map((p) => p.id))]) {
      const entry: Obj = { discussionId: id, resolve: picks.some((p) => p.verb === "resolve" && p.id === id) };
      if (picks.some((p) => p.verb === "post" && p.id === id)) {
        const card = qs.map((q) => ctxOf(q, "carryover@1")).find((c) => c?.thread === id);
        const body = text ?? (nonEmpty(card?.reply) ? card.reply : undefined);
        if (body !== undefined) entry.body = body;
      }
      replies.push(entry);
    }
  }
  if (replies.length > 0) selection.replies = replies;

  const skipped = qs.flatMap((q) => {
    const card = ctxOf(q, "skipped@1");
    return Array.isArray(card?.skipped) ? card.skipped.filter(isObj) : [];
  });
  const restored: Obj[] = [];
  for (const k of numberedKeys(raw, "skipped")) {
    for (const p of valuesOf(a[k]).map(splitVerb)) {
      if (p.verb !== "restore") continue;
      const entry = skipped.find((s) => s.id === p.id);
      restored.push({ id: p.id, changed: entry?.changed === true });
    }
  }
  if (restored.length > 0) selection.restored = restored;
  return selection;
}
