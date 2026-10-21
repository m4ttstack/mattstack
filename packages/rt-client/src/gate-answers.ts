import type { GateQuestion, GateAnswer, GateWriteIn } from "./commands.ts";
import { gateOptionValue } from "./gate-options.ts";

export type GateAnswerWire = GateAnswer["answers"][string];

export function isWriteIn(raw: unknown): raw is GateWriteIn {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && "writeIn" in (raw as Record<string, unknown>);
}

/** Both wire shapes carry the same value underneath: bare, or {value,
    note?, text?} when a panel attaches free text or a replacement for text
    the gate offered. Unwrapping keeps only the value. */
export function unwrapGateAnswerValue(raw: unknown): unknown {
  if (isWriteIn(raw)) return undefined;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function textsError(qid: string, texts: unknown, value: unknown): string | null {
  if (!texts || typeof texts !== "object" || Array.isArray(texts)) return `question ${qid} texts must be an object`;
  if (!Array.isArray(value)) return `question ${qid} texts needs an array value`;
  for (const [id, t] of Object.entries(texts)) {
    if (typeof t !== "string" || t.trim() === "") return `question ${qid} texts must be non-empty strings`;
    if (!value.includes(id)) return `question ${qid} texts key must be one of its values: ${id}`;
  }
  return null;
}

function wrapperFieldError(qid: string, raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("value" in (raw as Record<string, unknown>))) {
    return null;
  }
  const { note, text, texts, value } = raw as Record<string, unknown>;
  if (note !== undefined && typeof note !== "string") return `question ${qid} note must be a string`;
  if (text !== undefined && typeof text !== "string") return `question ${qid} text must be a string`;
  if (typeof text === "string" && text.trim() === "") return `question ${qid} text must not be empty`;
  if (texts !== undefined) return textsError(qid, texts, value);
  return null;
}

function writeInError(question: GateQuestion, raw: GateWriteIn): string | null {
  const qid = question.id;
  if (question.writeIn !== true) return `question ${qid} does not accept a write-in`;
  if (Object.keys(raw).some((k) => k !== "writeIn")) return `question ${qid} writeIn replaces value, note and text; send it alone`;
  const text: unknown = raw.writeIn;
  if (typeof text !== "string" || text.trim() === "") return `question ${qid} writeIn must be a non-empty string`;
  return null;
}

/** Option membership is required whenever a question declares options,
    checked against the unwrapped value (every element, for multi); an
    empty options array stays free-form. Every question id must appear as
    an answers key. A question marked `writeIn` may instead carry `{writeIn}`,
    checked by `writeInError`. Error strings are a wire contract; packages/rt-client/test/gate-answers.test.ts pins them verbatim. */
export function validateGateAnswers(
  questions: GateQuestion[],
  answers: Record<string, unknown>,
): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [qid, raw] of Object.entries(answers)) {
    const question = byId.get(qid);
    if (!question) return `unknown question id: ${qid}`;
    if (isWriteIn(raw)) {
      const error = writeInError(question, raw);
      if (error) return error;
      continue;
    }
    const wrapperError = wrapperFieldError(qid, raw);
    if (wrapperError) return wrapperError;
    const value = unwrapGateAnswerValue(raw);
    const isArray = Array.isArray(value);
    if (question.multi && !isArray) return `question ${qid} expects an array (multi)`;
    if (!question.multi && isArray) return `question ${qid} expects a single value`;
    const values = isArray ? (value as unknown[]) : [value];
    if (!values.every((v) => typeof v === "string")) return `question ${qid} value must be a string`;
    if (question.options.length > 0) {
      const members = question.options.map(gateOptionValue);
      for (const v of values as string[]) {
        if (!members.includes(v)) return `answer for "${qid}" is not one of its options: "${v}"`;
      }
    }
  }
  const missing = questions
    .map((q) => q.id)
    .filter((id) => !Object.prototype.hasOwnProperty.call(answers, id));
  if (missing.length > 0) return `missing answer(s) for: ${missing.join(", ")}`;
  return null;
}
