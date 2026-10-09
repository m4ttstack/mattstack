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
  /** The caller's working directories, both spellings, for the fork-check's worktree rule. */
  worktrees?: string[];
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

/** The binding loses managed readiness for its current generation only; pending run and gate state is untouched. */
async function recordUnavailable(context: CallerContext, action: WorkflowAction | "stop", message: string): Promise<void> {
  const [{ withdrawBindingReady }, { getStateDb }, { warn }] = await Promise.all([
    import("./session-store.ts"), import("../state/db.ts"), import("../ui/warn.ts"),
  ]);
  const { binding } = context;
  withdrawBindingReady(getStateDb(), binding.key, binding.attachment.generation);
  warn("policy", "a session's workflow policy could not decide, so it is not ready for managed work", {
    context: { key: binding.key, generation: binding.attachment.generation, action, message },
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

/** The fork-check payload for a bound caller: its own session and pane, never the asking tool's name. */
export function forkCheckPayloadFor(context: CallerContext, subject: string, worktrees?: string[]): ForkCheckPayload {
  const { binding } = context;
  return {
    ...(subject.trim() !== "" && { subject }),
    sessionIds: [binding.native.value],
    ...(binding.attachment.pane !== undefined && { paneId: binding.attachment.pane }),
    ...(worktrees !== undefined && worktrees.length > 0 && { worktrees }),
  };
}

async function defaultForkCheck(payload: ForkCheckPayload): Promise<ForkCheckResponse> {
  const [{ gateForkCheck }, { GATE_FORK_HOOK_TIMEOUT_SECONDS }] = await Promise.all([
    import("../../packages/rt-client/src/client.ts"), import("../agent-hooks.ts"),
  ]);
  return gateForkCheck(payload, { timeoutMs: (GATE_FORK_HOOK_TIMEOUT_SECONDS * 1000) / 2 });
}

async function authorizeAsk(context: CallerContext, subject: string, deps: PolicyDeps): Promise<Outcome<void>> {
  let res: ForkCheckResponse;
  try {
    res = await (deps.forkCheck ?? defaultForkCheck)(forkCheckPayloadFor(context, subject, deps.worktrees));
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
  const [{ findRunsBySession }, { snapshot }] = await Promise.all([import("../runs/store.ts"), import("../runs/write.ts")]);
  return {
    findRunning: deps.findRunning
      ?? ((sessionId) => findRunsBySession(sessionId).filter((m) => m.summary.status === "running").map((m) => m.runDb)),
    // `rt runs snapshot`'s rows, read without the migration a write verb's open runs.
    snapshot: deps.snapshot ?? ((runDb) => {
      if (!existsSync(runDb)) throw new Error(`run DB not found: ${runDb}`);
      const db = new Database(runDb, { readonly: true });
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
    return {
      startedAt: pyInt(r.started_at),
      runId: String(orElse(r.id, "?")),
      stage: String(orElse(r.current_stage, "unknown")),
      state: current("hold") || current("waiting-gate") ? "held" : "open",
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
    } catch {
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
  const { checkRunDb } = await import("../mcp/run-tools.ts");
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
