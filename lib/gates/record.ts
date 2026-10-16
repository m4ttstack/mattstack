import type { GateAnswer } from "../../packages/rt-client/src/commands.ts";

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
