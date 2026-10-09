/**
 * Shared gate and continuation policy: whether a session may ask a native
 * question, act on a pipeline run, or end its turn. Every harness's hook or
 * mod translates its own event into one of these calls; a native tool name
 * never reaches here.
 *
 * The question rule is the daemon's `gate:fork-check`, so `rt gate ask` and
 * this decision share one subject resolver. The Stop rule is
 * `plugins/mattstack/hooks/pipeline-gate-stop.sh`'s, which stays installed
 * as Claude's backstop with its own copy of the rule: a change to
 * `stopStateOf` must land in that script too (the parity test holds them
 * equal).
 *
 * A policy that cannot decide is unavailable, never allow. The caller picks
 * its own escape (Claude's hooks let the turn or question through), and the
 * session is recorded as unready for managed work.
 */

import { Database } from "bun:sqlite";
import { existsSync, realpathSync } from "fs";
import type { CallerContext, FaultCode, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../packages/rt-client/src/commands.ts";
import type { RtResponse } from "../../packages/rt-client/src/transport.ts";

export type WorkflowAction = "ask" | "continue" | "complete";

/** The fault an unavailable policy reports; `refused` is a decision, this is the lack of one. */
export const POLICY_UNAVAILABLE: FaultCode = "transient";

export function isPolicyUnavailable(outcome: Outcome<unknown>): boolean {
  return !outcome.ok && outcome.error.code === POLICY_UNAVAILABLE;
}

export type ForkCheckPayload = Commands["gate:fork-check"]["payload"];
export type ForkCheckResponse = RtResponse<Commands["gate:fork-check"]["data"]> | null;

export type PolicyDeps = {
  /** The daemon's fork-check; the daemon passes its own handler, a CLI caller the socket. */
  forkCheck?: (payload: ForkCheckPayload) => Promise<ForkCheckResponse>;
  /**
   * What the caller's native event carried beyond its binding: other ids its
   * session goes by and its working directory. The process cwd stands in for
   * a missing cwd, as it does for the hook; a daemon caller passes the session's.
   * `alsoCwds` are further directories that only widen the fork-check's
   * worktree match, the one route a directory feeds.
   */
  caller?: { sessionIds?: string[]; cwd?: string; alsoCwds?: string[] };
  /** Run stores `rt runs find --session <id> --running` would list, newest first. */
  findRunning?: (sessionId: string) => string[];
  /** The `rt runs snapshot` JSON of one run store. */
  snapshot?: (runDb: string) => unknown;
  /** Where the runs root comes from (RT_RUNS_ROOT), for the run tools' validator. */
  env?: NodeJS.ProcessEnv;
  onUnavailable?: (context: CallerContext, action: WorkflowAction | "stop", message: string) => void | Promise<void>;
};

function fail<T>(code: FaultCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

async function unavailable<T>(context: CallerContext, action: WorkflowAction | "stop", message: string, deps: PolicyDeps): Promise<Outcome<T>> {
  try {
    await (deps.onUnavailable ?? recordUnavailable)(context, action, message);
  } catch {
    // A failed record must not turn the unavailable outcome into a thrown hook.
  }
  return fail(POLICY_UNAVAILABLE, message);
}

/**
 * The binding loses managed readiness for its current generation only and
 * raises a recoverable attention reason; pending run and gate state is
 * untouched. The attention announcement exists only where the daemon's gate
 * question service runs.
 */
async function recordUnavailable(context: CallerContext, action: WorkflowAction | "stop", message: string): Promise<void> {
  const [{ withdrawBindingReady }, { getStateDb }, { warn }, { gateQuestionService }] = await Promise.all([
    import("./session-store.ts"), import("../state/db.ts"), import("../ui/warn.ts"), import("./questions.ts"),
  ]);
  const { binding } = context;
  const withdrawn = withdrawBindingReady(getStateDb(), binding.key, binding.attachment.generation);
  const detail = { key: binding.key, generation: binding.attachment.generation, action, message };
  warn("policy", "a session's workflow policy could not decide, so it is not ready for managed work", {
    context: { ...detail, withdrawn: withdrawn.ok ? withdrawn.data : withdrawn.error },
  });
  policyAttention(gateQuestionService(), context, action, message);
}

/**
 * The attention condition native questions already raise, under its own
 * reason: `policy-unavailable` when the policy could not decide,
 * `policy-escaped` when a hook let a stop through after its continuation
 * cap. A launch or resume that verifies the session's policy again recovers it.
 */
export function policyAttention(
  service: { native: { attention(detail: Record<string, unknown> & { reason: string }): void } } | null,
  context: CallerContext, action: WorkflowAction | "stop", message: string,
  reason: "policy-unavailable" | "policy-escaped" = "policy-unavailable",
): void {
  const { binding } = context;
  service?.native.attention({
    reason, harness: binding.native.harness, sessionKey: binding.key,
    generation: binding.attachment.generation, action, detail: message,
  });
}

// ─── Questions ───────────────────────────────────────────────────────────────

export function forkDenyReason(subject: string | undefined): string {
  return "Blocking forks go through the gate protocol first: run `rt gate ask --questions <json>` "
    + "(with --context quoting the decision material), then act on the presentation it returns. "
    + "form: ask it here with AskUserQuestion, which this hook then allows, and submit the pick with `rt gate answer <id> --answers <json> --by pane`. "
    + "wait: background `rt gate wait <id>` and end the turn."
    + (subject ? ` This pane's gates file under ${JSON.stringify(subject)}.` : "");
}

export type ForkVerdict = { kind: "allow" } | { kind: "deny"; subject?: string } | { kind: "unavailable"; reason: string };

export function forkVerdict(res: ForkCheckResponse): ForkVerdict {
  if (!res) return { kind: "unavailable", reason: "the gate service gave no verdict" };
  if (!res.ok || !res.data) return { kind: "unavailable", reason: `the gate service could not decide: ${res.error ?? "no data"}` };
  if (res.data.allow) return { kind: "allow" };
  return { kind: "deny", ...(res.data.subject !== undefined && { subject: res.data.subject }) };
}

export type ForkCheckInputs = {
  /** The launch's gate subject; absent, the caller is not an `rt agent` launch and is not gated. */
  subject?: string;
  /** Every id the caller's session goes by: a hook's own id can differ from the one `rt gate ask` stamps. */
  sessionIds: readonly unknown[];
  pane?: string;
  /** The caller's working directory. */
  cwd: string;
  /** Other directories the caller's run gates may have been filed from. */
  alsoCwds?: readonly string[];
};

/**
 * The one fork-check payload builder, for the Claude hook and for
 * authorizeWorkflowAction alike. Null means allow without asking the daemon.
 * Both spellings of the directory ride along: a run records whichever path
 * its pipeline saw, and a symlinked tree differs between the logical and the
 * physical one.
 */
export function buildForkCheck(inputs: ForkCheckInputs): ForkCheckPayload | null {
  if (!inputs.subject) return null;
  const payload: ForkCheckPayload = { subject: inputs.subject };
  const sessionIds = [...new Set(inputs.sessionIds)].filter((s): s is string => typeof s === "string" && s.length > 0);
  if (sessionIds.length > 0) payload.sessionIds = sessionIds;
  if (inputs.pane !== undefined) payload.paneId = inputs.pane;
  const worktrees: string[] = [];
  for (const cwd of [inputs.cwd, ...(inputs.alsoCwds ?? [])]) {
    worktrees.push(cwd);
    try {
      worktrees.push(realpathSync(cwd));
    } catch { /* a vanished cwd still matches by its given spelling */ }
  }
  payload.worktrees = [...new Set(worktrees)];
  return payload;
}

/** The fork-check payload for a bound caller: its own session ids, pane and directory, never the asking tool's name. */
export function forkCheckPayloadFor(context: CallerContext, subject: string, caller: PolicyDeps["caller"] = {}): ForkCheckPayload | null {
  const { binding } = context;
  return buildForkCheck({
    subject,
    sessionIds: [binding.native.value, ...(caller.sessionIds ?? [])],
    ...(binding.attachment.pane !== undefined && { pane: binding.attachment.pane }),
    cwd: caller.cwd ?? process.cwd(),
    ...(caller.alsoCwds !== undefined && { alsoCwds: caller.alsoCwds }),
  });
}

async function defaultForkCheck(payload: ForkCheckPayload): Promise<ForkCheckResponse> {
  const [{ gateForkCheck }, { GATE_FORK_HOOK_TIMEOUT_SECONDS }] = await Promise.all([
    import("../../packages/rt-client/src/client.ts"), import("../agent-hooks.ts"),
  ]);
  return gateForkCheck(payload, { timeoutMs: (GATE_FORK_HOOK_TIMEOUT_SECONDS * 1000) / 2 });
}

async function authorizeAsk(context: CallerContext, subject: string, deps: PolicyDeps): Promise<Outcome<void>> {
  const payload = forkCheckPayloadFor(context, subject, deps.caller);
  if (payload === null) return { ok: true, data: undefined };
  let res: ForkCheckResponse;
  try {
    res = await (deps.forkCheck ?? defaultForkCheck)(payload);
  } catch (err) {
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const verdict = forkVerdict(res);
  if (verdict.kind === "allow") return { ok: true, data: undefined };
  if (verdict.kind === "deny") return fail("refused", forkDenyReason(verdict.subject));
  return unavailable(context, "ask", verdict.reason, deps);
}

// ─── Runs ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function rowOf(raw: unknown): Row | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Row : null;
}

type RunReaders = Required<Pick<PolicyDeps, "findRunning" | "snapshot">>;

/** Loaded on first use, so `rt gate fork-check`, which a hook timeout bounds, never pays for the run store. */
async function runReaders(deps: PolicyDeps): Promise<RunReaders> {
  if (deps.findRunning && deps.snapshot) return { findRunning: deps.findRunning, snapshot: deps.snapshot };
  const [{ findRunsBySession, RunsUnreadableError }, { snapshot }] = await Promise.all([import("../runs/store.ts"), import("../runs/write.ts")]);
  return {
    // Strict: a runs root or run DB that exists but cannot be read makes the decision unavailable, never "no runs".
    findRunning: deps.findRunning
      ?? ((sessionId) => findRunsBySession(sessionId, undefined, { strict: true }).filter((m) => m.summary.status === "running").map((m) => m.runDb)),
    // `rt runs snapshot`'s rows, read without the migration a write verb's open runs.
    snapshot: deps.snapshot ?? ((runDb) => {
      if (!existsSync(runDb)) throw new Error(`run DB not found: ${runDb}`);
      let db: Database;
      try {
        db = new Database(runDb, { readonly: true });
      } catch (err) {
        throw new RunsUnreadableError(runDb, err);
      }
      try {
        const snap = snapshot(db);
        if (!snap.ok) throw new Error(snap.error);
        return snap;
      } finally {
        db.close();
      }
    }),
  };
}

/** Python's int() over the values a snapshot carries; anything else throws, which skips the run as the shell does. */
function pyInt(v: unknown): number {
  if (v === null || v === undefined || v === 0 || v === "" || v === false) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "boolean") return 1;
  if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) return Number.parseInt(v, 10);
  throw new Error(`not an integer: ${String(v)}`);
}

/** Python's `x or fallback` over a JSON value. */
function orElse(v: unknown, fallback: unknown): unknown {
  return v === null || v === undefined || v === "" || v === 0 || v === false ? fallback : v;
}

function fieldMap(snap: Row): Map<unknown, Row> {
  const fields = new Map<unknown, Row>();
  for (const f of Array.isArray(snap.fields) ? snap.fields : []) {
    const field = rowOf(f);
    if (field) fields.set(field.key, field);
  }
  return fields;
}

export type StopState = { startedAt: number; runId: string; stage: string; state: "held" | "open" };

/**
 * pipeline-gate-stop.sh's per-run rule: a running run this session owns is
 * held when a hold or an armed gate wait, other than the cleared `-`, was set
 * after its latest stage started; otherwise it is open. Null when the run is
 * not this session's running run or its snapshot does not read.
 */
export function stopStateOf(raw: unknown, sessionId: string): StopState | null {
  const snap = rowOf(raw);
  if (!snap) return null;
  try {
    const r = rowOf(orElse(snap.run, {})) ?? {};
    if (r.status !== "running") return null;
    const fields = fieldMap(snap);
    if (fields.get("claude-session")?.value !== sessionId) return null;
    const starts = (Array.isArray(snap.stages) ? snap.stages : []).map((s) => {
      const stage = rowOf(s);
      if (!stage) throw new Error("a stage is not an object");
      return pyInt(stage.started_at);
    });
    const lastStart = starts.length > 0 ? Math.max(...starts) : 0;
    const current = (key: string): boolean => {
      const f = fields.get(key) ?? {};
      return f.value !== null && f.value !== undefined && f.value !== "" && f.value !== "-" && pyInt(f.at) > lastStart;
    };
    const held = current("hold");
    const waiting = current("waiting-gate");
    return {
      startedAt: pyInt(r.started_at),
      runId: String(orElse(r.id, "?")),
      stage: String(orElse(r.current_stage, "unknown")),
      state: held || waiting ? "held" : "open",
    };
  } catch {
    return null;
  }
}

export function stopReason(runId: string, stage: string): string {
  return `Run \`${runId}\` is \`running\` in stage \`${stage}\`. A turn cannot end here in prose. Five exits: continue the stage; `
    + `open the decision (\`rt runs field set gate <scope> --stage ${stage}\`, one sentence, then run gate-protocol's Runs integration with kind \`<scope>\`, stop); `
    + `park it (\`rt runs field set hold "<why>" --stage ${stage}\`); `
    + `close it (the close gate, then \`rt runs run-status --status done|failed|abandoned\`); `
    + `or arm a gate wait (\`rt runs field set waiting-gate <gateId> --stage ${stage}\`, fire the background wait per gate-protocol, end the turn). `
    + "If the user asked you something mid-run, the answer is the sentence before the gate.";
}

export type StopVerdict = { decision: "allow" } | { decision: "continue"; runId: string; stage: string; reason: string };

/** evaluateStop with the run and stage it named and the reason a hook shows. */
export async function inspectStop(context: CallerContext, deps: PolicyDeps = {}): Promise<Outcome<StopVerdict>> {
  const sessionId = context.binding.native.value;
  let candidates: string[];
  let readers: RunReaders;
  try {
    readers = await runReaders(deps);
    candidates = readers.findRunning(sessionId);
  } catch (err) {
    return unavailable(context, "stop", `the session's runs could not be read: ${err instanceof Error ? err.message : String(err)}`, deps);
  }
  let best: StopState | null = null;
  for (const runDb of candidates) {
    let snap: unknown;
    try {
      snap = readers.snapshot(runDb);
    } catch (err) {
      // A run that vanished or whose snapshot fails is skipped, as the shell's `|| continue` does; one that exists and cannot be opened is not.
      if (err instanceof Error && err.name === "RunsUnreadableError") {
        return unavailable(context, "stop", `the session's runs could not be read: ${err.message}`, deps);
      }
      continue;
    }
    const state = stopStateOf(snap, sessionId);
    if (state && (best === null || state.startedAt > best.startedAt)) best = state;
  }
  if (best === null || best.state !== "open") return { ok: true, data: { decision: "allow" } };
  return { ok: true, data: { decision: "continue", runId: best.runId, stage: best.stage, reason: stopReason(best.runId, best.stage) } };
}

/**
 * Whether the caller may end its turn: `continue` when its newest owned
 * running run has an open stage, `allow` otherwise, including no run at all.
 * Allowing a stop never completes a run.
 */
export async function evaluateStop(context: CallerContext, deps: PolicyDeps = {}): Promise<Outcome<"allow" | "continue">> {
  const verdict = await inspectStop(context, deps);
  return verdict.ok ? { ok: true, data: verdict.data.decision } : verdict;
}

async function authorizeRun(context: CallerContext, action: "continue" | "complete", runDb: string, deps: PolicyDeps): Promise<Outcome<void>> {
  const { checkRunDb } = await import("../runs/run-db-check.ts");
  const checked = checkRunDb(runDb, deps.env ?? process.env, (p) => realpathSync(p));
  if (!checked.ok) return fail("invalid", checked.error);
  let snap: Row | null;
  try {
    snap = rowOf((await runReaders(deps)).snapshot(checked.real));
  } catch (err) {
    return unavailable(context, action, `run ${runDb} could not be read: ${err instanceof Error ? err.message : String(err)}`, deps);
  }
  const run = rowOf(snap?.run ?? null);
  if (!snap || !run) return fail("invalid", `run ${runDb} has no run record`);
  const owner = fieldMap(snap).get("claude-session")?.value;
  if (typeof owner !== "string" || owner === "") {
    return fail("ambiguous", `run ${String(run.id ?? runDb)} records no owning session, so no session may ${action} it`);
  }
  if (owner !== context.binding.native.value) return fail("refused", `run ${String(run.id ?? runDb)} belongs to another session`);
  if (run.status !== "running") return fail("refused", `run ${String(run.id ?? runDb)} has ended (${String(run.status)}), so it cannot ${action}`);
  // complete's result preconditions (stage outcomes, the close gate) stay with the run verbs; this is ownership only.
  return { ok: true, data: undefined };
}

/**
 * Whether the caller may take a workflow action. `ask` is a native question
 * under gate subject `subject` (the launch's gate subject); `continue` and
 * `complete` act on the run whose store is `subject`, which only its owning
 * session may do while it runs.
 */
export async function authorizeWorkflowAction(
  context: CallerContext, action: WorkflowAction, subject: string, deps: PolicyDeps = {},
): Promise<Outcome<void>> {
  if (action === "ask") return authorizeAsk(context, subject, deps);
  return authorizeRun(context, action, subject, deps);
}
