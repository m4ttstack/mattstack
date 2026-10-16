/**
 * The gate tools: gate_open, gate_reconcile, gate_record, and the run-aware
 * paths behind gate_ask and gate_answer. Run reads and writes go through
 * runToolDefs()'s own handlers, so a caller's runDb meets the same runs-root
 * confinement as run_* tools.
 * The only run writes here are `gate`, `waiting-gate`,
 * `extra.context-dropped.<scope>`, `extra.gate-source.<scope>` and gate@1
 * decisions on the caller's scope.
 */
import { readFileSync, writeFileSync } from "fs";
import { gateAnswer, gateAsk, gateWait } from "../../packages/rt-client/src/index.ts";
import type { Commands, GateQuestion, GateRow } from "../../packages/rt-client/src/index.ts";
import { checkSource, fitOpen, GATE_CTX_LIMIT, proseOpen, type FitResult, type GateCtxSource } from "../gates/ctx.ts";
import { dropContextsToFit, flattenContext, formChunks, paneActionFor, truncateOptionText, type TruncatedText } from "../gates/form.ts";
import { isObject, tojson, utf8Bytes } from "../gates/jq.ts";
import { buildReviewSource, reviewSourceErrors } from "../gates/review-source.ts";
import {
  actOnWriteIn, decisionForGate, nextOf, normalizeAnswers, postSelection, respondPlanSelection, respondPostSelection,
  skipReason, writeInsOf,
  type AnswersMap, type DecisionRow, type PlanRow, type RecordShape,
} from "../gates/record.ts";
import { realRunToolDeps, runToolDefs, type RunToolDeps } from "./run-tools.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, type McpToolDef, type ToolResult } from "./shared.ts";
import {
  checkReadRootPath, checkTempRootPath, readRootsForThisProcess, tempRootsForThisProcess, type ReadRoots,
} from "./temp-root-guard.ts";

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

export const ANSWERED_RUN_PROPS = {
  ...GATE_RUN_PROPS,
  scope: {
    type: "string",
    description: "The decision scope on the run; defaults to the scope whose extra.gate-source.<scope> names this gate (post for a review-post gate), else the gate's kind.",
  },
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

/** The scope an answered gate records under when the caller names none: the one
    whose stored gate source names this gate, since a kind need not be its
    scope (review-post records under post); else the row's kind. */
function answeredScope(input: Record<string, unknown>, run: RunHandle, row: GateRow): string {
  if (typeof input.scope === "string") return input.scope;
  const prefix = "extra.gate-source.";
  for (const f of run.snapshot.fields) {
    if (!f.key.startsWith(prefix)) continue;
    try {
      if ((JSON.parse(f.value) as { gate?: unknown }).gate === row.id) return f.key.slice(prefix.length);
    } catch {
      continue;
    }
  }
  return row.kind;
}

function wellFormed(questions: unknown[]): questions is GateQuestion[] {
  return questions.every((q) => typeof q === "object" && q !== null && Array.isArray((q as { options?: unknown }).options));
}

function scopeError(input: Record<string, unknown>): string | undefined {
  const scope = input.scope;
  if (scope !== undefined && (typeof scope !== "string" || scope.trim() === "")) return '"scope" must be a non-empty string';
  return undefined;
}

/** The shared open path (gate_ask and gate_open). */
export async function askGate(
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  deps: GateToolDeps,
  extra: { proseById?: Record<string, string>; formContext?: string; contextDropped?: boolean; run?: RunHandle | null } = {},
): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "questions", type: "array" }]) ?? scopeError(input);
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

type AnswerFields = Pick<RecordResult, "decidedBy" | "answers" | "writeIn" | "next" | "actOnWriteIn">;

function answerFieldsOf(raw: AnswersMap, decidedBy: string): AnswerFields {
  const answers = normalizeAnswers(raw);
  return { decidedBy, answers, writeIn: writeInsOf(answers), next: nextOf(answers), actOnWriteIn: actOnWriteIn(answers) };
}

function answerFields(row: GateRow): AnswerFields {
  return answerFieldsOf(row.answer?.answers ?? {}, row.answer?.by ?? "unknown");
}

export interface RecordOptions {
  scope: string;
  shape: RecordShape;
  record: boolean;
  source?: GateCtxSource;
  contextDropped?: boolean | string[];
  held?: string[];
}

async function clearWaitingGate(run: RunHandle, gateId: string): Promise<string | null> {
  return fieldValue(run, "waiting-gate") === gateId ? run.field("waiting-gate", "-") : null;
}

/** `gate` is null for a handed decision; `lateSince` null skips the
    late-answer rule (an explicit record upserts). */
async function recordDecision(
  run: RunHandle,
  fields: AnswerFields,
  gate: { id: string; questions: GateQuestion[] } | null,
  lateSince: number | null,
  o: RecordOptions,
): Promise<RecordResult> {
  const result: RecordResult = { recorded: false, ...fields };
  const runErrors: string[] = [];

  if (lateSince !== null && decisionForGate(run.snapshot.decisions, o.scope, lateSince)) {
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
        const droppedHere = gate !== null && fieldValue(run, `extra.context-dropped.${o.scope}`) === gate.id;
        const built = respondPlanSelection(fields.answers, {
          source: o.source,
          storedQuestions: gate?.questions,
          contextDropped: droppedHere ? true : o.contextDropped,
        });
        selection = built.selection;
        result.rows = built.rows;
      } else if (o.shape === "respond-post") {
        selection = respondPostSelection(fields.answers, { source: o.source, storedQuestions: gate?.questions, held: o.held });
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

  if (gate) {
    const failed = await clearWaitingGate(run, gate.id);
    if (failed) runErrors.push(failed);
  }
  if (runErrors.length > 0) result.runErrors = runErrors;
  return result;
}

/** Records an answered row's decision on the run and clears waiting-gate when
    it names this gate, recorded or not. The late-answer rule applies unless
    `upsert` (gate_record re-recording its own gate). */
export async function recordAnswered(
  run: RunHandle,
  row: GateRow,
  o: RecordOptions & { upsert?: boolean },
): Promise<RecordResult> {
  return recordDecision(run, answerFields(row), row, o.upsert ? null : row.openedAt, o);
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
    scope: answeredScope(input, opened.run, row),
    shape: "answers",
    record: input.record !== false,
  });
  return ok({ ...res.data, ...recorded });
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function refused(what: string, problems: string[]): { error: string } {
  return { error: `${what} was refused:\n${problems.join("\n")}` };
}

function readJsonFile(path: unknown, name: string, deps: GateToolDeps): { value: unknown } | { error: string } {
  const { roots, pluginListError } = deps.readRoots();
  const checked = checkReadRootPath(path, roots, pluginListError, ".json");
  if (!checked.ok) return { error: `${name}: ${checked.error}` };
  let text: string;
  try {
    text = deps.readFile(checked.realpath);
  } catch (e) {
    return { error: `${name}: cannot read ${path}: ${messageOf(e)}` };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `${name}: ${path} is not valid JSON (${messageOf(e)})` };
  }
}

function validated(source: unknown): { source: GateCtxSource } | { error: string } {
  const checked = checkSource(source);
  if (!checked.ok) return refused("the gate source", checked.problems);
  const s = source as GateCtxSource;
  return { source: "context" in s ? { context: s.context, questions: s.questions } : { questions: s.questions } };
}

function reviewSource(review: unknown, deps: GateToolDeps): { source: GateCtxSource } | { error: string } {
  if (!isObject(review)) return { error: '"review" must be an object' };
  if ((review.findings !== undefined) === (review.findingsPath !== undefined)) {
    return { error: 'pass exactly one of "review.findings" or "review.findingsPath"' };
  }
  if (review.extras === undefined) return { error: '"review.extras" is required' };
  let findings = review.findings;
  if (review.findingsPath !== undefined) {
    const read = readJsonFile(review.findingsPath, "review.findingsPath", deps);
    if ("error" in read) return read;
    findings = read.value;
  }
  const problems = reviewSourceErrors(findings, review.extras);
  if (problems.length > 0) return refused("the review source", problems);
  return validated(buildReviewSource(findings as Record<string, unknown>, review.extras as Record<string, unknown>));
}

/** The validated, untrimmed gate source named by exactly one of `source`,
    `sourcePath` or `review`. */
export function resolveSource(input: Record<string, unknown>, deps: GateToolDeps): { source: GateCtxSource } | { error: string } {
  const given = ["source", "sourcePath", "review"].filter((k) => input[k] !== undefined);
  if (given.length !== 1) return { error: 'pass exactly one of "source", "sourcePath" or "review"' };
  if (input.source !== undefined) return validated(input.source);
  if (input.sourcePath !== undefined) {
    const read = readJsonFile(input.sourcePath, "sourcePath", deps);
    return "error" in read ? read : validated(read.value);
  }
  return reviewSource(input.review, deps);
}

function proseByQuestion(source: GateCtxSource): { formContext?: string; proseById: Record<string, string> } {
  const prose = proseOpen(source);
  const proseById: Record<string, string> = {};
  for (const q of prose.questions) if (typeof q.context === "string") proseById[String(q.id)] = q.context;
  return { formContext: prose.context, proseById };
}

async function handBack(
  input: Record<string, unknown>,
  source: GateCtxSource,
  fit: FitResult,
  run: RunHandle | null,
  scope: string,
  deps: GateToolDeps,
): Promise<ToolResult> {
  const fitted = { questions: fit.questions as unknown as GateQuestion[], ...(fit.context !== undefined ? { context: fit.context } : {}) };
  const { open: afterDrops, dropped } = dropContextsToFit(fitted, GATE_CTX_LIMIT);
  const shaped = wellFormed(afterDrops.questions);
  const { questions, truncated } = shaped
    ? truncateOptionText(afterDrops.questions)
    : { questions: afterDrops.questions, truncated: [] as TruncatedText[] };
  const open = { ...afterDrops, questions };
  const { formContext, proseById } = proseByQuestion(source);
  const result: Record<string, unknown> = {
    open,
    mode: fit.mode,
    fits: fit.fits,
    trimmed: fit.trimmed,
    contextDropped: !fit.fits,
    droppedContexts: dropped,
    ...(formContext !== undefined ? { formContext } : {}),
    formChunks: shaped ? formChunks(questions, proseById) : [],
  };
  if (truncated.length > 0) result.labelsTruncated = truncated;

  if (typeof input.outPath === "string") {
    let bytes = open.context === undefined ? 0 : utf8Bytes(open.context);
    for (const q of open.questions) if (typeof q.context === "string") bytes += utf8Bytes(q.context);
    const file = { mode: fit.mode, trimmed: fit.trimmed, ...(open.context !== undefined ? { context: open.context } : {}), questions: open.questions, bytes, fits: fit.fits };
    try {
      deps.writeFile(input.outPath, `${tojson(file)}\n`);
    } catch (e) {
      return err(`outPath: could not write ${input.outPath}: ${messageOf(e)}`);
    }
    result.outPath = input.outPath;
  }

  if (run) {
    const failed = await run.field(`extra.gate-source.${scope}`, JSON.stringify({ gate: null, source }));
    if (failed) result.runErrors = [failed];
  }
  return ok(result);
}

export async function openGate(input: Record<string, unknown>, env: NodeJS.ProcessEnv, deps: GateToolDeps): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "kind", type: "string" }])
    ?? checkOptional(input, [
      { name: "sourcePath", type: "string" }, { name: "subject", type: "string" }, { name: "handBack", type: "boolean" },
      { name: "outPath", type: "string" }, { name: "runDb", type: "string" }, { name: "stage", type: "string" },
    ])
    ?? scopeError(input);
  if (bad) return err(bad);
  const kind = (input.kind as string).trim();
  if (kind === "") return err('"kind" must be a non-empty string');
  const handingBack = input.handBack === true;
  if (input.outPath !== undefined && !handingBack) return err('"outPath" is written only with "handBack": true');
  if (handingBack && input.outPath !== undefined) {
    const out = checkTempRootPath(input.outPath, deps.tempRoots());
    if (!out.ok) return err(`outPath: ${out.error}`);
  }

  const resolved = resolveSource(input, deps);
  if ("error" in resolved) return err(resolved.error);
  const { source } = resolved;
  const fit = fitOpen(source);

  const opened = await openRun(input, env, deps);
  if (opened && "error" in opened) return err(opened.error);
  const run = opened?.run ?? null;
  const scope = typeof input.scope === "string" ? input.scope : kind;
  if (handingBack) return handBack(input, source, fit, run, scope, deps);

  const { formContext, proseById } = proseByQuestion(source);
  const askInput: Record<string, unknown> = { questions: fit.questions, kind: input.kind };
  if (fit.context !== undefined) askInput.context = fit.context;
  if (input.subject !== undefined) askInput.subject = input.subject;
  if (input.scope !== undefined) askInput.scope = input.scope;
  const asked = await askGate(askInput, env, deps, { run, proseById, formContext, contextDropped: !fit.fits });
  if (!asked.ok) return asked;

  const data = asked.body as Record<string, unknown>;
  const runErrors = [...((data.runErrors as string[] | undefined) ?? [])];
  if (run) {
    const failed = await run.field(`extra.gate-source.${scope}`, JSON.stringify({ gate: data.id, source }));
    if (failed) runErrors.push(failed);
  }
  const result: Record<string, unknown> = {
    ...data,
    mode: fit.mode,
    fits: fit.fits,
    trimmed: fit.trimmed,
    contextDropped: !fit.fits || data.contextOmitted === true,
  };
  if (runErrors.length > 0) result.runErrors = runErrors;
  return ok(result);
}

export async function reconcileGate(input: Record<string, unknown>, env: NodeJS.ProcessEnv, deps: GateToolDeps): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "id", type: "string" }])
    ?? checkOptional(input, [{ name: "record", type: "boolean" }])
    ?? scopeError(input);
  if (bad) return err(bad);
  const opened = await openRun(input, env, deps);
  if (opened && "error" in opened) return err(opened.error);
  const run = opened?.run ?? null;

  const id = input.id as string;
  const payload: Commands["gate:wait"]["payload"] = { id, waitMs: 2000 };
  if (env.CLAUDE_CODE_SESSION_ID) payload.sessionId = env.CLAUDE_CODE_SESSION_ID;
  const res = await deps.wait(payload);
  if (!res.ok && res.error === "not-found") return err(`no gate ${id}`);
  if (!res.ok || !res.data) return fromResponse(res);
  const data = res.data;
  if (data.status === "timeout") return ok({ status: "open", id });

  const { row } = data;
  if (data.status === "closed") {
    const result: Record<string, unknown> = { status: "closed", id, closedReason: row.closedReason, supersededBy: row.supersededBy };
    const failed = run ? await clearWaitingGate(run, id) : null;
    if (failed) result.runErrors = [failed];
    return ok(result);
  }
  if (!run) return ok({ status: "answered", row, recorded: false, ...answerFields(row) });
  const recorded = await recordAnswered(run, row, {
    scope: answeredScope(input, run, row),
    shape: "answers",
    record: input.record !== false,
  });
  return ok({ status: "answered", row, ...recorded });
}

const RECORD_SHAPES: RecordShape[] = ["answers", "respond-plan", "respond-post", "post"];

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function recordInputError(input: Record<string, unknown>): string | undefined {
  const bad = checkRequired(input, [{ name: "runDb", type: "string" }, { name: "stage", type: "string" }, { name: "scope", type: "string" }])
    ?? checkOptional(input, [{ name: "shape", type: "string" }, { name: "gateId", type: "string" }, { name: "decidedBy", type: "string" }])
    ?? scopeError(input);
  if (bad) return bad;
  if (input.shape !== undefined && !RECORD_SHAPES.includes(input.shape as RecordShape)) {
    return `"shape" must be one of ${RECORD_SHAPES.join(", ")}`;
  }
  if ((input.gateId === undefined) === (input.answers === undefined)) return 'pass exactly one of "gateId" or "answers"';
  if (input.answers !== undefined) {
    const answers = checkRequired(input, [{ name: "answers", type: "object" }]);
    if (answers) return answers;
    if (typeof input.decidedBy !== "string" || input.decidedBy.trim() === "") return '"decidedBy" is required with "answers"';
  } else if (input.decidedBy !== undefined) {
    return '"decidedBy" is only for handed "answers"';
  }
  if (input.held !== undefined && !isStringArray(input.held)) return '"held" must be an array of strings';
  const dropped = input.contextDropped;
  if (dropped !== undefined && typeof dropped !== "boolean" && !isStringArray(dropped)) {
    return '"contextDropped" must be a boolean or an array of question ids';
  }
  return undefined;
}

/** The scope's stored gate source, or null when absent or unreadable. */
function storedSource(run: RunHandle, scope: string): { gate: string | null; at: number; source?: GateCtxSource } | null {
  const field = run.snapshot.fields.find((f) => f.key === `extra.gate-source.${scope}`);
  if (field === undefined) return null;
  try {
    const parsed = JSON.parse(field.value) as { gate?: unknown; source?: unknown };
    return {
      gate: typeof parsed.gate === "string" ? parsed.gate : null,
      at: field.at,
      ...(isObject(parsed.source) ? { source: parsed.source as unknown as GateCtxSource } : {}),
    };
  } catch {
    return null;
  }
}

export async function recordGate(input: Record<string, unknown>, env: NodeJS.ProcessEnv, deps: GateToolDeps): Promise<ToolResult> {
  const bad = recordInputError(input);
  if (bad) return err(bad);
  let given: GateCtxSource | undefined;
  if (["source", "sourcePath", "review"].some((k) => input[k] !== undefined)) {
    const resolved = resolveSource(input, deps);
    if ("error" in resolved) return err(resolved.error);
    given = resolved.source;
  }
  const opened = await openRun(input, env, deps);
  if (!opened || "error" in opened) return err(opened?.error ?? "run_snapshot failed");
  const { run } = opened;

  const scope = input.scope as string;
  const stored = storedSource(run, scope);
  const o: RecordOptions = {
    scope,
    shape: (input.shape as RecordShape | undefined) ?? "answers",
    record: true,
    contextDropped: input.contextDropped as boolean | string[] | undefined,
    held: input.held as string[] | undefined,
  };
  if (input.answers !== undefined) {
    const fields = answerFieldsOf(input.answers as AnswersMap, (input.decidedBy as string).trim());
    return ok(await recordDecision(run, fields, null, null, { ...o, source: given ?? stored?.source }));
  }

  const id = input.gateId as string;
  const res = await deps.wait({ id, waitMs: 0 });
  if (!res.ok && res.error === "not-found") return err(`no gate ${id}`);
  if (!res.ok || !res.data) return fromResponse(res);
  const data = res.data;
  if (data.status === "timeout") return err(`gate ${id} is still open; record it once it is answered`);
  if (data.status === "closed") return err(`gate ${id} is closed (${data.row.closedReason ?? "closed"}) and has no answer to record`);
  if (typeof stored?.gate === "string" && stored.gate !== id && stored.at > data.row.openedAt) {
    return ok({ recorded: false, skipped: `stale gate; ${scope}'s latest gate is ${stored.gate}`, ...answerFields(data.row) });
  }
  // Another gate's cards would misbuild this gate's selection; without them the
  // builders fall back to the row's own stored questions. A hand-back source
  // stored after this gate opened belongs to a later re-ask.
  const handBackBefore = stored?.gate === null && stored.at <= data.row.openedAt;
  const ownCards = stored !== null && (stored.gate === id || handBackBefore) ? stored.source : undefined;
  return ok(await recordAnswered(run, data.row, { ...o, source: given ?? ownCards, upsert: true }));
}

const GATE_OPEN_DESCRIPTION = "Build, validate and size-fit a structured gate from a gate-ctx@1 source (source inline, sourcePath a .json file under a read root, or review: {findings | findingsPath, extras} built by the review-source recipe first), then open it with gate_ask's ceremony. It opens a gate only when called and never picks an answer: the skill owns the gate, presents it and answers it. A source with problems is refused with one line per problem and nothing opens. The context is fitted to the shared 8192-byte budget (structured with optional parts trimmed, else prose); the form view is always the prose of the untrimmed source. Under a run, pass runDb and stage: scope defaults to kind and no kind maps to another scope, so a review-post gate passes scope: \"post\" itself. The untrimmed source is stored as extra.gate-source.<scope>. Returns gate_ask's result plus mode (structured | prose), fits, trimmed, contextDropped (fits false or the daemon dropped context), formContext and formChunks. handBack: true opens nothing and returns {open: {context, questions}, mode, fits, trimmed, contextDropped, droppedContexts, formContext, formChunks, labelsTruncated?}, with option text truncated as gate_ask does and dropping whole question contexts largest first (then the gate context) when even prose is over budget; outPath also writes the open, in gate-ctx.sh's output shape, to a temp-root file.";

const GATE_RECONCILE_DESCRIPTION = "The one call for every re-entry to a gate: a finished background rt gate wait, a doorbell, or words typed at a held gate. It re-reads the gate for up to 2 seconds with this session's id (stamping the pane's read as rt gate wait does); rt gate wait itself stays background Bash, since no tool blocks past its timeout. answered: returns {status: \"answered\", row, answers, decidedBy, writeIn, next, actOnWriteIn} and, under a run (runDb and stage), records the normalized answers map as a gate@1 decision on scope (default the scope whose extra.gate-source.<scope> names this gate, else the gate's kind) with the answer's by as the decider, unless a decision on that scope already landed since the gate opened (alreadyReconciled) or record is false; it clears waiting-gate when it names this gate. closed: returns {status: \"closed\", closedReason, supersededBy}, clears waiting-gate and never invents an answer. Still open after 2 seconds: {status: \"open\"}, nothing written and waiting-gate left armed. The skill owns the gate and decides what to do next.";

const GATE_RECORD_DESCRIPTION = "Record a gate decision on a run that no gate tool recorded at answer time: a review scope at its site's own point (respond-plan, respond-post and post after acting), or a decision handed in by the caller (answers plus decidedBy, for a board wrapper). runDb, stage and scope are required. gateId reads that answered gate (an open or closed gate is refused) and its answer's by is the decider. shape picks the selection: answers (the normalized answers map, never skipped), respond-plan ({threads, texts?, overrides?, notes?, code-changes} plus rows for the report), respond-post ({threads: {<id>: {post, resolve, text?, note?}}, held?}) or post ({findings, disposition, replies?, restored?}); the three review shapes record nothing when a next answer other than proceed is present. Cards come from source, sourcePath or review when passed, else from the run's extra.gate-source.<scope>. It always upserts its own gate, so a held respond-post resume re-records with held; it refuses only a stale gate, one whose scope's stored source names a different gate stored after this one opened. Returns {recorded, selection, decidedBy, rows?, answers, writeIn, next, actOnWriteIn, skipped?, runErrors?}. It records only; the skill acts.";

const GATE_SOURCE_PROPS = {
  source: { type: "object", description: "A gate-ctx@1 source: {context?, questions}." },
  sourcePath: { type: "string", description: "A .json gate-ctx@1 source file under the Claude Code temp root or an installed plugin or pack root." },
  review: {
    type: "object",
    description: "Build the source from a review's findings first: findings inline or findingsPath (a .json file under a read root), and extras {target, reviewer?, round?, questions}.",
    properties: { findings: { type: "object" }, findingsPath: { type: "string" }, extras: { type: "object" } },
  },
};

export function gateToolDefs(deps: GateToolDeps = realGateToolDeps): McpToolDef[] {
  return [
    {
      name: "gate_open",
      description: GATE_OPEN_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", description: "The registry kind, as gate_ask takes it (respond-plan, review-post, ...)." },
          ...GATE_SOURCE_PROPS,
          subject: { type: "string" },
          handBack: { type: "boolean", description: "Build and fit only; open nothing." },
          outPath: { type: "string", description: "With handBack: also write the open to this path under the Claude Code temp root." },
          ...GATE_RUN_PROPS,
        },
        required: ["kind"],
        additionalProperties: false,
      },
      shellForms: { none: "replaces sh gate-ctx.sh / review-source.sh once wave 3 rewrites the skills" },
      async handler(input, env) {
        return openGate(input, env, deps);
      },
    },
    {
      name: "gate_reconcile",
      description: GATE_RECONCILE_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The gate id." },
          record: { type: "boolean", description: "Record the answers map on the run (default true); review sites pass false and record with gate_record." },
          ...ANSWERED_RUN_PROPS,
        },
        required: ["id"],
        additionalProperties: false,
      },
      shellForms: { none: "replaces rt gate wait <id> --timeout 2s and the run bookkeeping a skill did by hand after a wait, doorbell or held gate" },
      async handler(input, env) {
        return reconcileGate(input, env, deps);
      },
    },
    {
      name: "gate_record",
      description: GATE_RECORD_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          runDb: { type: "string", description: "The run's runDb; the decision is written there." },
          stage: { type: "string", description: "The stage recording." },
          scope: { type: "string", description: "The decision scope on the run (respond-plan, respond-post, post, ...)." },
          shape: { type: "string", enum: RECORD_SHAPES, description: "How the selection is built; default answers." },
          gateId: { type: "string", description: "An answered gate whose row is read; its answer's by is the decider." },
          answers: { type: "object", description: "A handed decision's answers, recorded with decidedBy instead of a gate's row." },
          decidedBy: { type: "string", description: "Who decided a handed decision (board, console, ...); required with answers." },
          ...GATE_SOURCE_PROPS,
          contextDropped: {
            description: "respond-plan: true, or the question ids whose context never reached the gate.",
            oneOf: [{ type: "boolean" }, { type: "array", items: { type: "string" } }],
          },
          held: { type: "array", items: { type: "string" }, description: "respond-post: the thread ids held back from posting." },
        },
        required: ["runDb", "stage", "scope"],
        additionalProperties: false,
      },
      shellForms: { none: "replaces the jq selection builders and rt run decision calls the review skills ran by hand" },
      async handler(input, env) {
        return recordGate(input, env, deps);
      },
    },
  ];
}
