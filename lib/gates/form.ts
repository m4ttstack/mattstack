import type { GateQuestion } from "../../packages/rt-client/src/commands.ts";
import { type GateOptionObject, normalizeGateOptions } from "../../packages/rt-client/src/gate-options.ts";
import { contextShapeErrors, proseContext } from "./ctx.ts";
import { isObject, utf8Bytes } from "./jq.ts";
import { endTrunc, midTrunc } from "./review-source.ts";

export const LABEL_CAP_BYTES = 200;
export const DESCRIPTION_CAP_BYTES = 1024;
const FORM_CHUNK_SIZE = 4;

const GATE_SHAPES = ["plan@1", "post@1", "review@1"];
const QUESTION_SHAPES = ["thread@1", "reply@1", "findings@1", "carryover@1", "skipped@1"];

export interface TruncatedText {
  question: string;
  value: string;
  field: "label" | "description";
}

export function truncateOptionText(questions: GateQuestion[]): { questions: GateQuestion[]; truncated: TruncatedText[] } {
  const truncated: TruncatedText[] = [];
  const out = questions.map((q) => ({
    ...q,
    options: q.options.map((o) => {
      if (typeof o === "string" || o === null || typeof o !== "object") return o;
      const next = { ...o };
      if (typeof o.label === "string" && utf8Bytes(o.label) > LABEL_CAP_BYTES) {
        next.label = midTrunc(o.label, LABEL_CAP_BYTES);
        truncated.push({ question: q.id, value: o.value, field: "label" });
      }
      if (typeof o.description === "string" && utf8Bytes(o.description) > DESCRIPTION_CAP_BYTES) {
        next.description = endTrunc(o.description, DESCRIPTION_CAP_BYTES);
        truncated.push({ question: q.id, value: o.value, field: "description" });
      }
      return next;
    }),
  }));
  return { questions: out, truncated };
}

export function flattenContext(
  context: string | undefined,
  where: { level: "gate" } | { level: "question"; values: string[] },
): string | undefined {
  if (context === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(context);
  } catch {
    return context;
  }
  if (!isObject(parsed)) return context;
  const errs =
    where.level === "gate"
      ? contextShapeErrors(parsed, "context", GATE_SHAPES, [])
      : contextShapeErrors(parsed, "context", QUESTION_SHAPES, where.values);
  return errs.length === 0 ? proseContext(parsed) : context;
}

export interface FormQuestion {
  id: string;
  label: string;
  text: string;
  multi: boolean;
  options: GateOptionObject[];
}

export function formChunks(questions: GateQuestion[], proseById: Record<string, string> = {}): FormQuestion[][] {
  const items = questions.map((q): FormQuestion => {
    const options = normalizeGateOptions(q.options);
    const prose =
      proseById[q.id] ?? flattenContext(q.context, { level: "question", values: options.map((o) => o.value) });
    return {
      id: q.id,
      label: q.label,
      text: prose?.trim() ? `${q.label}\n${prose}` : q.label,
      multi: q.multi,
      options,
    };
  });
  const chunks: FormQuestion[][] = [];
  for (let i = 0; i < items.length; i += FORM_CHUNK_SIZE) chunks.push(items.slice(i, i + FORM_CHUNK_SIZE));
  return chunks;
}

export type PaneAction = "form" | "wait";

export function paneActionFor(presentation: "form" | "wait", o: { herdr: boolean; spawned: boolean }): PaneAction {
  return presentation === "wait" && (o.herdr || o.spawned) ? "wait" : "form";
}

type Open = { context?: string; questions: GateQuestion[] };

export function dropContextsToFit(open: Open, limit: number): { open: Open; dropped: string[] } {
  const questions = open.questions.map((q) => ({ ...q }));
  let context = open.context;
  const bytesOf = (s: string | undefined): number => (s === undefined ? 0 : utf8Bytes(s));
  let total = bytesOf(context) + questions.reduce((n, q) => n + bytesOf(q.context), 0);
  const dropped: string[] = [];

  const order = questions
    .map((q, i) => ({ i, bytes: bytesOf(q.context) }))
    .filter((e) => questions[e.i]!.context !== undefined)
    .sort((a, b) => b.bytes - a.bytes || a.i - b.i);
  for (const { i, bytes } of order) {
    if (total < limit) break;
    delete questions[i]!.context;
    total -= bytes;
    dropped.push(questions[i]!.id);
  }
  if (total >= limit && context !== undefined) context = undefined;

  const next: Open = { questions };
  if (context !== undefined) next.context = context;
  return { open: next, dropped };
}
