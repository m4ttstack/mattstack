import type { GateQuestion } from "../../packages/rt-client/src/commands.ts";
import { gateOptionLabel, gateOptionValue } from "../../packages/rt-client/src/gate-options.ts";
import { type AnswersMap, type DecisionRow, answerValue, splitVerb } from "./record.ts";

export type GateMode = "chatty" | "normal" | "quiet" | "yolo";
export type Reach = "worktree" | "draft" | "teammates" | "public";

const MODES: readonly GateMode[] = ["chatty", "normal", "quiet", "yolo"];
const REACHES: readonly Reach[] = ["worktree", "draft", "teammates", "public"];
const ALLOWED: Record<GateMode, readonly Reach[]> = {
  chatty: [],
  normal: ["worktree"],
  quiet: ["worktree", "draft"],
  yolo: ["worktree", "draft", "teammates"],
};
const STOP_VERBS = new Set(["handback", "hand-back", "abandon", "iterate", "go-back", "hold"]);
const RECOMMENDED_SUFFIX = /\(\s*recommended\s*\)\s*$/i;
const MODE_DECIDER = "mode:";

export const GATE_MODE_ERROR = '"gateMode" must be one of chatty, normal, quiet, yolo';

export function parseMode(v: unknown): GateMode {
  return MODES.find((m) => m === v) ?? "chatty";
}

export function parseReach(v: unknown): Reach | null {
  return REACHES.find((r) => r === v) ?? null;
}

export function modeAllows(mode: GateMode, reach: Reach): boolean {
  return ALLOWED[mode].includes(reach);
}

export function effectiveMode(runFieldValue: string | undefined, settingValue: unknown): GateMode {
  return parseMode(runFieldValue !== undefined ? runFieldValue : settingValue);
}

const NON_WORK_PIPELINES = new Set(["review", "receive-review", "self-review"]);

/** A self-review inherited inside a work run carries the work run's pipeline, so only a standalone one reads as self-review. */
export function isWorkPipeline(pipeline: string | null): boolean {
  return pipeline !== null && !NON_WORK_PIPELINES.has(pipeline);
}

export function recommendedValues(q: GateQuestion): string[] {
  return q.options
    .filter((o) => (typeof o !== "string" && o.recommended === true) || RECOMMENDED_SUFFIX.test(gateOptionLabel(o)))
    .map(gateOptionValue);
}

type AutoAnswer =
  | { kind: "answer"; answers: Record<string, string | string[]> }
  | { kind: "ask"; reason: string };

const verbOf = (value: string): string => splitVerb(value.replace(RECOMMENDED_SUFFIX, "").trim().toLowerCase()).verb.trim();
const stopVerb = (value: string): boolean => STOP_VERBS.has(verbOf(value));

export function autoAnswerDecision(i: {
  mode: GateMode;
  pipeline: string | null;
  reach: Reach | null;
  needsOperator?: string;
  context?: string;
  questions: GateQuestion[];
}): AutoAnswer {
  const ask = (reason: string): AutoAnswer => ({ kind: "ask", reason });
  if (i.mode === "chatty") return ask("mode is chatty");
  if (!isWorkPipeline(i.pipeline)) return ask(`pipeline ${i.pipeline} always asks`);
  if (i.reach === null) return ask("the gate declares no reach");
  if (!modeAllows(i.mode, i.reach)) return ask(`mode ${i.mode} does not cover reach ${i.reach}`);
  if (i.needsOperator) return ask(`needs the operator: ${i.needsOperator}`);
  if (i.context?.includes("boards@1")) return ask("the gate carries a boards@1 choice");
  if (i.questions.length === 0) return ask("the gate has no questions");

  const answers: Record<string, string | string[]> = {};
  for (const q of i.questions) {
    const rec = recommendedValues(q);
    if (rec.length === 0) return ask(`question ${q.id} has no recommendation`);
    if (rec.some(stopVerb)) return ask(`question ${q.id} recommends stopping`);
    if (!q.multi && rec.length > 1) return ask(`question ${q.id} has more than one recommendation`);
    if (q.id === "next" && !rec.every((v) => ["proceed", "done"].includes(verbOf(v)))) {
      return ask("next does not recommend proceed or done");
    }
    answers[q.id] = q.multi ? rec : rec[0]!;
  }
  return { kind: "answer", answers };
}

const isGate = (d: DecisionRow): boolean => d.contract === "gate@1";
const byMode = (d: DecisionRow): boolean => d.decided_by.startsWith(MODE_DECIDER);

function describeSelection(selection: string): string {
  try {
    const parsed: unknown = JSON.parse(selection);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return selection;
    return Object.entries(parsed as Record<string, never>)
      .map(([k, v]) => {
        const val = answerValue(v);
        return `${k}=${Array.isArray(val) ? val.join("|") : (val ?? "write-in")}`;
      })
      .join(", ");
  } catch {
    return selection;
  }
}

export function modeDecisionLine(mode: GateMode, scope: string, answers: AnswersMap): string {
  return `${mode} mode decided ${scope}: ${describeSelection(JSON.stringify(answers))}`;
}

export function modeDigest(decisions: DecisionRow[], sinceAt: number): string | null {
  const lines = decisions
    .filter((d) => isGate(d) && byMode(d) && d.decided_at > sinceAt)
    .sort((a, b) => a.decided_at - b.decided_at)
    .map((d) => `- ${d.scope}: ${describeSelection(d.selection)}`);
  return lines.length === 0 ? null : ["Decided without you since your last answer:", ...lines].join("\n");
}

export function digestSince(decisions: DecisionRow[]): number {
  return decisions.filter((d) => isGate(d) && !byMode(d)).reduce((n, d) => Math.max(n, d.decided_at), 0);
}
