/**
 * The gate tools' run-aware paths: the shared open path behind gate_ask,
 * the answer path behind gate_answer, and the recorder that writes a gate@1
 * decision. Run reads and writes go through runToolDefs()'s own handlers, so
 * a caller's runDb meets the same runs-root confinement as run_* tools. The
 * only run writes here are `gate`, `waiting-gate`,
 * `extra.context-dropped.<scope>` and gate@1 decisions on the caller's scope.
 */
import { readFileSync, writeFileSync } from "fs";
import { gateAnswer, gateAsk, gateWait } from "../../packages/rt-client/src/index.ts";
import type { Commands, GateQuestion, GateRow } from "../../packages/rt-client/src/index.ts";
import type { GateCtxSource } from "../gates/ctx.ts";
import { flattenContext, formChunks, paneActionFor, truncateOptionText, type TruncatedText } from "../gates/form.ts";
import {
  actOnWriteIn, decisionForGate, nextOf, normalizeAnswers, postSelection, respondPlanSelection, respondPostSelection,
  skipReason, writeInsOf,
  type AnswersMap, type DecisionRow, type PlanRow, type RecordShape,
} from "../gates/record.ts";
import { realRunToolDeps, runToolDefs, type RunToolDeps } from "./run-tools.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, type ToolResult } from "./shared.ts";
import { readRootsForThisProcess, tempRootsForThisProcess, type ReadRoots } from "./temp-root-guard.ts";

export interface GateToolDeps {
  ask: typeof gateAsk;
  answer: typeof gateAnswer;
  wait: typeof gateWait;
  runDeps: RunToolDeps;
  readRoots: () => ReadRoots;
  tempRoots: () => string[];
  readFile: (p: string) => string;
  writeFile: (p: string, s: string) => void;
}

export const realGateToolDeps: GateToolDeps = {
  ask: gateAsk,
  answer: gateAnswer,
  wait: gateWait,
  runDeps: realRunToolDeps,
  readRoots: readRootsForThisProcess,
  tempRoots: tempRootsForThisProcess,
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, s) => writeFileSync(p, s),
};

export interface RunSnapshot {
  run: { spawned_by: string | null };
  fields: { key: string; value: string; at: number }[];
  decisions: DecisionRow[];
}

export interface RunHandle {
  snapshot: RunSnapshot;
  /** null when the write landed, else its error. */
  field(key: string, value: string): Promise<string | null>;
  decision(scope: string, selection: object, by: string): Promise<string | null>;
}

export interface RecordResult {
  recorded: boolean;
  alreadyReconciled?: boolean;
  skipped?: string;
  selection?: Record<string, unknown>;
  decidedBy: string;
  answers: AnswersMap;
  writeIn: { question: string; text: string }[];
  next: string | null;
  actOnWriteIn: boolean;
  rows?: PlanRow[];
  runErrors?: string[];
}

const DEFAULT_KIND = "question";

export const GATE_RUN_PROPS = {
  runDb: { type: "string", description: "The run's runDb, under a pipeline run; the gate's run fields and decision are written there." },
  stage: { type: "string", description: "The stage asking; required with runDb." },
  scope: { type: "string", description: "The decision scope on the run; defaults to the gate's kind." },
};

function runHandler(defs: ReturnType<typeof runToolDefs>, name: string) {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`run tool ${name} is missing`);
  return def.handler;
}

function snapshotOf(body: unknown): RunSnapshot {
  const b = (body ?? {}) as { run?: { spawned_by?: unknown } | null; fields?: unknown[]; decisions?: unknown[] };
  const spawned = b.run?.spawned_by;
  return {
    run: { spawned_by: typeof spawned === "string" && spawned !== "" ? spawned : null },
    fields: (b.fields ?? []).map((f) => {
      const r = f as { key: string; value: string; at: number };
      return { key: r.key, value: r.value, at: r.at };
    }),
    decisions: (b.decisions ?? []).map((d) => {
      const r = d as DecisionRow;
      return { contract: r.contract, scope: r.scope, selection: r.selection, decided_by: r.decided_by, decided_at: r.decided_at };
    }),
  };
}

/** null when the caller passed no runDb. A runDb needs a stage, and a runDb the
    run tools refuse is refused here, before anything opens. */
export async function openRun(
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  deps: GateToolDeps,
): Promise<{ run: RunHandle } | { error: string } | null> {
  const bad = checkOptional(input, [{ name: "runDb", type: "string" }, { name: "stage", type: "string" }, { name: "scope", type: "string" }]);
  if (bad) return { error: bad };
  if (input.runDb === undefined) return null;
  if (typeof input.stage !== "string" || input.stage === "") return { error: '"stage" is required with "runDb"' };
  const runDb = input.runDb as string;
  const stage = input.stage;
  const defs = runToolDefs(deps.runDeps);
  const snapshot = runHandler(defs, "run_snapshot");
  const fieldSet = runHandler(defs, "run_field_set");
  const decision = runHandler(defs, "run_decision");

  const snap = await snapshot({ runDb }, env);
  if (!snap.ok) return { error: snap.error ?? "run_snapshot failed" };
  const failed = (r: ToolResult): string | null => (r.ok ? null : r.error ?? "run write failed");
  return {
    run: {
      snapshot: snapshotOf(snap.body),
      field: async (key, value) => failed(await fieldSet({ runDb, key, value, stage }, env)),
      decision: async (scope, selection, by) =>
        failed(await decision({ runDb, contract: "gate@1", scope, selection, decidedBy: by }, env)),
    },
  };
}

function fieldValue(run: RunHandle, key: string): string | undefined {
  return run.snapshot.fields.find((f) => f.key === key)?.value;
}

function wellFormed(questions: unknown[]): questions is GateQuestion[] {
  return questions.every((q) => typeof q === "object" && q !== null && Array.isArray((q as { options?: unknown }).options));
}

/** The shared open path (gate_ask and gate_open). */
export async function askGate(
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  deps: GateToolDeps,
  extra: { proseById?: Record<string, string>; formContext?: string; contextDropped?: boolean; run?: RunHandle | null } = {},
): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "questions", type: "array" }]);
  if (bad) return err(bad);

  let run: RunHandle | null;
  if ("run" in extra) {
    run = extra.run ?? null;
  } else {
    const opened = await openRun(input, env, deps);
    if (opened && "error" in opened) return err(opened.error);
    run = opened?.run ?? null;
  }
  const kind = typeof input.kind === "string" && input.kind.trim() !== "" ? input.kind.trim() : DEFAULT_KIND;
  const scope = typeof input.scope === "string" ? input.scope : kind;

  if (run) {
    const failed = await run.field("gate", scope);
    if (failed) return err(`the run's gate field did not save, so no gate was opened: ${failed}`);
  }

  const raw = input.questions as unknown[];
  const shaped = wellFormed(raw);
  const { questions, truncated } = shaped
    ? truncateOptionText(raw)
    : { questions: raw as GateQuestion[], truncated: [] as TruncatedText[] };
  const payload: Commands["gate:ask"]["payload"] = { questions };
  if (input.context !== undefined) payload.context = input.context as string;
  if (input.kind !== undefined) payload.kind = input.kind as string;
  // No RT_GATE_SUBJECT read (contract C13): the var carries an agent:<id>
  // fallback on every rt-agent launch and would shadow the daemon
  // ladder's run rung; absent an input subject, the daemon resolves
  // session -> run -> the agent record's own subject.
  if (input.subject !== undefined) payload.subject = input.subject as string;
  if (env.CLAUDE_CODE_SESSION_ID) payload.sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (env.HERDR_PANE_ID) payload.paneId = env.HERDR_PANE_ID;
  const res = await deps.ask(payload);
  if (!res.ok || !res.data) return fromResponse(res);
  const data = res.data;

  const paneAction = paneActionFor(data.presentation, { herdr: env.HERDR_ENV === "1", spawned: run?.snapshot.run.spawned_by != null });
  const runErrors: string[] = [];
  if (run) {
    const writes: [string, string][] = [];
    if (paneAction === "wait") writes.push(["waiting-gate", data.id]);
    if (extra.contextDropped === true || data.contextOmitted === true) writes.push([`extra.context-dropped.${scope}`, data.id]);
    for (const [key, value] of writes) {
      const failed = await run.field(key, value);
      if (failed) runErrors.push(failed);
    }
  }

  const formContext = extra.formContext ?? (typeof input.context === "string" ? flattenContext(input.context, { level: "gate" }) : undefined);
  const result: Record<string, unknown> = { ...data, paneAction, formChunks: shaped ? formChunks(questions, extra.proseById) : [] };
  if (formContext !== undefined) result.formContext = formContext;
  if (truncated.length > 0) result.labelsTruncated = truncated;
  if (runErrors.length > 0) result.runErrors = runErrors;
  return ok(result);
}

function answerFields(row: GateRow): Pick<RecordResult, "decidedBy" | "answers" | "writeIn" | "next" | "actOnWriteIn"> {
  const answers = normalizeAnswers(row.answer?.answers ?? {});
  return { decidedBy: row.answer?.by ?? "unknown", answers, writeIn: writeInsOf(answers), next: nextOf(answers), actOnWriteIn: actOnWriteIn(answers) };
}

/** Records an answered row's decision on the run under the late-answer rule,
    and clears waiting-gate when it names this gate, recorded or not. */
export async function recordAnswered(
  run: RunHandle,
  row: GateRow,
  o: { scope: string; shape: RecordShape; record: boolean; source?: GateCtxSource; contextDropped?: boolean | string[]; held?: string[] },
): Promise<RecordResult> {
  const fields = answerFields(row);
  const result: RecordResult = { recorded: false, ...fields };
  const runErrors: string[] = [];

  if (decisionForGate(run.snapshot.decisions, o.scope, row.openedAt)) {
    result.alreadyReconciled = true;
    result.skipped = `already reconciled: ${o.scope} has a decision since this gate opened`;
  } else if (!o.record) {
    result.skipped = "record: false";
  } else {
    const skip = skipReason(o.shape, fields.answers);
    if (skip) {
      result.skipped = skip;
    } else {
      let selection: Record<string, unknown>;
      if (o.shape === "respond-plan") {
        const droppedHere = fieldValue(run, `extra.context-dropped.${o.scope}`) === row.id;
        const built = respondPlanSelection(fields.answers, {
          source: o.source,
          storedQuestions: row.questions,
          contextDropped: droppedHere ? true : o.contextDropped,
        });
        selection = built.selection;
        result.rows = built.rows;
      } else if (o.shape === "respond-post") {
        selection = respondPostSelection(fields.answers, { source: o.source, storedQuestions: row.questions, held: o.held });
      } else if (o.shape === "post") {
        selection = postSelection(fields.answers, { source: o.source });
      } else {
        selection = fields.answers;
      }
      result.selection = selection;
      const failed = await run.decision(o.scope, selection, fields.decidedBy);
      if (failed) runErrors.push(failed);
      else result.recorded = true;
    }
  }

  if (fieldValue(run, "waiting-gate") === row.id) {
    const failed = await run.field("waiting-gate", "-");
    if (failed) runErrors.push(failed);
  }
  if (runErrors.length > 0) result.runErrors = runErrors;
  return result;
}

export async function answerGate(input: Record<string, unknown>, env: NodeJS.ProcessEnv, deps: GateToolDeps): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "id", type: "string" }, { name: "answers", type: "object" }])
    ?? checkOptional(input, [{ name: "record", type: "boolean" }]);
  if (bad) return err(bad);
  const opened = await openRun(input, env, deps);
  if (opened && "error" in opened) return err(opened.error);

  const payload: Commands["gate:answer"]["payload"] = {
    id: input.id as string,
    answers: input.answers as Commands["gate:answer"]["payload"]["answers"],
    by: "pane",
    session: env.CLAUDE_CODE_SESSION_ID,
  };
  if (input.override !== undefined) payload.override = input.override as boolean;
  const res = await deps.answer(payload);
  if (!res.ok && res.error === "owned-by") {
    const owner = (res as { owner?: string }).owner ?? "unknown";
    return err(`gate ${input.id} is owned by ${owner}; pass override: true to answer anyway`);
  }
  if (!res.ok && res.error === "gate-closed") {
    const reason = (res as { reason?: string }).reason ?? "closed";
    const supersededBy = (res as { supersededBy?: string }).supersededBy;
    return err(`gate ${input.id} is closed (${reason})${supersededBy ? `; superseded by ${supersededBy}` : ""}`);
  }
  if (!res.ok && res.error === "not-found") return err(`no gate ${input.id}`);
  if (!res.ok || !res.data) return fromResponse(res);

  const { row } = res.data;
  if (!opened) return ok({ ...res.data, recorded: false, ...answerFields(row) });
  const recorded = await recordAnswered(opened.run, row, {
    scope: typeof input.scope === "string" ? input.scope : row.kind,
    shape: "answers",
    record: input.record !== false,
  });
  return ok({ ...res.data, ...recorded });
}
