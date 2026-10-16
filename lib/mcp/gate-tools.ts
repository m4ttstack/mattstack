/**
 * The gate tools: gate_open, and the run-aware paths behind gate_ask and
 * gate_answer. Run reads and writes go through runToolDefs()'s own handlers,
 * so a caller's runDb meets the same runs-root confinement as run_* tools.
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

const GATE_OPEN_DESCRIPTION = "Build, validate and size-fit a structured gate from a gate-ctx@1 source (source inline, sourcePath a .json file under a read root, or review: {findings | findingsPath, extras} built by the review-source recipe first), then open it with gate_ask's ceremony. It opens a gate only when called and never picks an answer: the skill owns the gate, presents it and answers it. A source with problems is refused with one line per problem and nothing opens. The context is fitted to the shared 8192-byte budget (structured with optional parts trimmed, else prose); the form view is always the prose of the untrimmed source. Under a run, pass runDb and stage: scope defaults to kind and no kind maps to another scope, so a review-post gate passes scope: \"post\" itself. The untrimmed source is stored as extra.gate-source.<scope>. Returns gate_ask's result plus mode (structured | prose), fits, trimmed, contextDropped (fits false or the daemon dropped context), formContext and formChunks. handBack: true opens nothing and returns {open: {context, questions}, mode, fits, trimmed, contextDropped, droppedContexts, formContext, formChunks, labelsTruncated?}, with option text truncated as gate_ask does and dropping whole question contexts largest first (then the gate context) when even prose is over budget; outPath also writes the open, in gate-ctx.sh's output shape, to a temp-root file.";

export function gateToolDefs(deps: GateToolDeps = realGateToolDeps): McpToolDef[] {
  return [
    {
      name: "gate_open",
      description: GATE_OPEN_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", description: "The registry kind, as gate_ask takes it (respond-plan, review-post, ...)." },
          source: { type: "object", description: "A gate-ctx@1 source: {context?, questions}." },
          sourcePath: { type: "string", description: "A .json gate-ctx@1 source file under the Claude Code temp root or an installed plugin or pack root." },
          review: {
            type: "object",
            description: "Build the source from a review's findings first: findings inline or findingsPath (a .json file under a read root), and extras {target, reviewer?, round?, questions}.",
            properties: { findings: { type: "object" }, findingsPath: { type: "string" }, extras: { type: "object" } },
          },
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
  ];
}
