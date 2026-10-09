/**
 * Codex's side of the shared policy: the translation of its native hook
 * events into authorizeWorkflowAction and evaluateStop, and the adapter that
 * inspects the installed hooks.
 *
 * Codex runs the manifest's hooks (hook-manifest.ts) as `rt agent
 * policy-hook`, handing each the native payload on stdin. A PreToolUse for
 * `request_user_input` is a question, so it asks the shared fork rule; a
 * Stop asks the shared continuation rule. Every other tool passes; for a
 * bound thread it still sends a receipt, so a check turn can count every run
 * of rt's hook. An unbound or detached thread and a malformed or foreign
 * payload pass with nothing written. The only writes a hook can cause are the shared policy's
 * own on an unavailable verdict (readiness withdrawn), the continuation
 * count below, and a receipt the daemon records as evidence; no hook
 * answers a gate or moves a run.
 *
 * Exit 2 with stderr is Codex's native refusal: on PreToolUse the tool call
 * is blocked and stderr is the model's feedback; on Stop the turn continues
 * with stderr as its instruction (G5). An unavailable policy lets the
 * question or the stop through, as Claude's hooks do, so a broken service
 * never traps a session.
 */

import { createHash } from "crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import type {
  CallerContext, Capability, NativeSessionRef, Outcome, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import type { LaunchRequest, PolicyAdapter, PolicyProof, PolicyVerifyContext, PreparedPolicy } from "../contracts.ts";
import type { PolicyDeps } from "../policy.ts";
import { CODEX_POLICY_CHECK_TURN_TIMEOUT_MS } from "../timeouts.ts";
import {
  CODEX_POLICY_EVENTS, CODEX_PROVEN_POLICY, MAX_ID_LENGTH, MAX_PATH_LENGTH, codexPolicyManifest, parseCodexPolicyHookCommand, plainText,
  validInstallationId, type CodexHookHandler, type CodexPolicyEvent,
} from "./hook-manifest.ts";
import {
  codexPolicyReceipts, type CodexHookVerdict, type CodexPolicyReceipt, type CodexPolicyReceipts, type CodexThreadEnv, type ReceiptPayload,
} from "./policy-receipts.ts";
import type { CodexSessionAdapter } from "./sessions.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { isRecord } from "./protocol.ts";
import { codexConfigPath, codexFolderTrust } from "./trust.ts";

// ─── Native payload ──────────────────────────────────────────────────────────

/** The native tool that opens a question; Codex's spelling of Claude's AskUserQuestion. */
export const CODEX_QUESTION_TOOL = "request_user_input";

export type CodexHookEvent = { event: CodexPolicyEvent; sessionId: string; turnId: string; cwd: string; tool?: string };

function fail<T>(code: "invalid" | "not-ready" | "stale-binding", message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

/**
 * The fields a policy decision reads from Codex's hook stdin, or why the
 * payload is not one. `expected` is the event the installed definition
 * names; a payload for any other event is foreign to it.
 */
export function parseCodexHook(input: unknown, expected?: CodexPolicyEvent): Outcome<CodexHookEvent> {
  if (!isRecord(input)) return fail("invalid", "the hook payload is not a JSON object");
  const event = input.hook_event_name;
  if (!(CODEX_POLICY_EVENTS as readonly unknown[]).includes(event)) return fail("invalid", "the hook payload names no policy event");
  if (expected !== undefined && event !== expected) return fail("invalid", `the hook was installed for ${expected} but ran for ${String(event)}`);
  if (!plainText(input.session_id, MAX_ID_LENGTH) || !plainText(input.turn_id, MAX_ID_LENGTH)) return fail("invalid", "the hook payload needs session_id and turn_id");
  if (!plainText(input.cwd, MAX_PATH_LENGTH) || !isAbsolute(input.cwd)) return fail("invalid", "the hook payload needs an absolute cwd");
  const parsed: CodexHookEvent = { event: event as CodexPolicyEvent, sessionId: input.session_id, turnId: input.turn_id, cwd: input.cwd };
  if (event === "PreToolUse") {
    if (!plainText(input.tool_name, MAX_ID_LENGTH)) return fail("invalid", "a PreToolUse payload needs tool_name");
    parsed.tool = input.tool_name;
  }
  return { ok: true, data: parsed };
}

// ─── Repeated continuation ──────────────────────────────────────────────────

/**
 * Claude Code lets a turn end after nine consecutive Stop blocks (observed on
 * 2.1.294), and the shared Stop rule relies on that cap as its loop guard
 * (pipeline-gate-stop.sh does not honour stop_hook_active). Codex keeps a
 * continued Stop inside the same turn, so a cap is counted here per thread
 * and turn.
 */
export const STOP_CONTINUATION_CAP = 8;

export interface StopCounter {
  /** This continuation's count within the turn, starting at 1; a counter that cannot count answers Infinity, which escapes. */
  bump(threadId: string, turnId: string): number;
  /** Drops a count held for any other turn of the thread: a new turn starts from nothing. */
  enterTurn(threadId: string, turnId: string): void;
  clear(threadId: string): void;
}

/** A count no hook has touched for a day belongs to a thread that is gone; each bump removes a bounded number of them. */
export const STOP_COUNT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STOP_COUNT_PRUNE_BATCH = 64;

/** One small file per thread under rt's own directory, since every hook run is its own process. */
export function fileStopCounter(dir: string, now: () => number = Date.now): StopCounter {
  const fileOf = (threadId: string) => join(dir, `${createHash("sha256").update(threadId).digest("hex").slice(0, 32)}.json`);
  const read = (file: string): { turnId: string; count: number } | undefined => {
    try {
      const held: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (isRecord(held) && typeof held.turnId === "string" && typeof held.count === "number" && Number.isInteger(held.count)) {
        return { turnId: held.turnId, count: held.count };
      }
    } catch { /* no count yet for this thread */ }
    return undefined;
  };
  const remove = (file: string) => {
    try {
      rmSync(file, { force: true });
    } catch { /* a stale count only shortens the next run of continuations */ }
  };
  const prune = (keep: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    // A small directory is checked whole; a large one from a random start, so every file is reached over time.
    const start = names.length <= STOP_COUNT_PRUNE_BATCH ? 0 : Math.floor(Math.random() * names.length);
    const batch = Array.from({ length: Math.min(names.length, STOP_COUNT_PRUNE_BATCH) }, (_, i) => names[(start + i) % names.length]!);
    for (const name of batch) {
      const file = join(dir, name);
      if (file === keep) continue;
      try {
        if (now() - statSync(file).mtimeMs > STOP_COUNT_MAX_AGE_MS) remove(file);
      } catch { /* removed by another hook run */ }
    }
  };
  return {
    bump(threadId, turnId) {
      const file = fileOf(threadId);
      const held = read(file);
      const count = held?.turnId === turnId ? held.count + 1 : 1;
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ turnId, count }));
        renameSync(tmp, file);
      } catch {
        return Number.POSITIVE_INFINITY;
      }
      prune(file);
      return count;
    },
    enterTurn(threadId, turnId) {
      const file = fileOf(threadId);
      const held = read(file);
      if (held !== undefined && held.turnId !== turnId) remove(file);
    },
    clear(threadId) {
      remove(fileOf(threadId));
    },
  };
}

// ─── Translation ─────────────────────────────────────────────────────────────

export type CodexHookResult = { exitCode: 0 | 2; stdout: string; stderr: string };

/** Codex reads an empty JSON object as no decision, so the native call goes ahead. */
export const CODEX_HOOK_PASS: CodexHookResult = Object.freeze({ exitCode: 0, stdout: "{}\n", stderr: "" });

/** Feedback reaches the model verbatim, so it is kept to a few lines of plain text. */
export const CODEX_FEEDBACK_LIMIT = 2000;

export type CodexHookDeps = {
  /** The event the installed definition names (`--event`). */
  event?: CodexPolicyEvent;
  /** The installation the definition names (`--installation`); without it no receipt is sent. */
  installation?: string;
  /** The executable the definition names (`--executable`), for the manifest revision a receipt carries; without it no receipt is sent. */
  executable?: string;
  env?: NodeJS.ProcessEnv;
  enabled?: () => boolean;
  resolve?: (native: NativeSessionRef) => Outcome<CallerContext>;
  subjectOf?: (binding: SessionBinding) => string | undefined;
  policy?: PolicyDeps;
  stops?: StopCounter;
  receipt?: (payload: ReceiptPayload) => Promise<unknown>;
  log?: (message: string, context: Record<string, unknown>) => void;
};

type Decision = { verdict: CodexHookVerdict; feedback?: string; detail?: string };

/** A receipt's detail is one line of plain text, as the daemon requires of every field. */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, CODEX_FEEDBACK_LIMIT);
}

function bounded(text: string): string {
  const clean = text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
  return clean.length <= CODEX_FEEDBACK_LIMIT ? clean : `${clean.slice(0, CODEX_FEEDBACK_LIMIT - 3)}...`;
}

/** The shared refusal names Claude's question tool; a Codex worker asks with its own. */
function codexWording(text: string): string {
  return text.replaceAll("AskUserQuestion", CODEX_QUESTION_TOOL);
}

function logToWarnings(message: string, context: Record<string, unknown>): void {
  void import("../../ui/warn.ts").then(({ warn }) => warn("codex-policy", message, { context }));
}

async function decideAsk(context: CallerContext, hook: CodexHookEvent, deps: CodexHookDeps): Promise<Decision> {
  const subject = (deps.subjectOf ?? (await import("../context.ts")).bindingGateSubject)(context.binding);
  if (subject === undefined) return { verdict: "allow" };
  const { authorizeWorkflowAction } = await import("../policy.ts");
  const outcome = await authorizeWorkflowAction(context, "ask", subject, { ...deps.policy, caller: { ...deps.policy?.caller, cwd: hook.cwd } });
  if (outcome.ok) return { verdict: "allow" };
  if (outcome.error.code === "refused") return { verdict: "refused", feedback: codexWording(outcome.error.message) };
  return { verdict: "unavailable", detail: outcome.error.message };
}

async function decideStop(context: CallerContext, hook: CodexHookEvent, deps: CodexHookDeps, stops: StopCounter): Promise<Decision> {
  stops.enterTurn(hook.sessionId, hook.turnId);
  const { inspectStop } = await import("../policy.ts");
  const outcome = await inspectStop(context, deps.policy);
  if (!outcome.ok) return { verdict: "unavailable", detail: outcome.error.message };
  if (outcome.data.decision === "allow") {
    stops.clear(hook.sessionId);
    return { verdict: "allow" };
  }
  const count = stops.bump(hook.sessionId, hook.turnId);
  if (count > STOP_CONTINUATION_CAP) {
    return { verdict: "escaped", detail: `run ${outcome.data.runId} was still open after ${STOP_CONTINUATION_CAP} continuations in one turn, so the turn may end` };
  }
  return { verdict: "continue", feedback: outcome.data.reason };
}

/**
 * The manifest revision this hook belongs to, from the executable path the
 * installed definition names, never the running process: a wrapper, a
 * symlink or rt run from source runs as another binary (live-14 D5). A
 * receipt naming another path still proves nothing, because proof also
 * needs the one native run from the inspected hooks file.
 */
function revisionOf(executable: string | undefined, installation: string): string | undefined {
  if (executable === undefined) return undefined;
  try {
    return codexPolicyManifest({ executable, installationId: installation }).revision;
  } catch {
    return undefined;
  }
}

async function sendReceipt(
  hook: CodexHookEvent, profile: string, threadEnv: CodexThreadEnv, decision: Decision, deps: CodexHookDeps, log: NonNullable<CodexHookDeps["log"]>,
): Promise<void> {
  const installation = deps.installation;
  if (!validInstallationId(installation)) return;
  const revision = revisionOf(deps.executable, installation);
  if (revision === undefined) return;
  const payload: ReceiptPayload = {
    installation, revision, profile, event: hook.event, ...(hook.tool !== undefined && { tool: hook.tool }),
    sessionId: hook.sessionId, turnId: hook.turnId, threadEnv, verdict: decision.verdict,
    ...(decision.detail !== undefined && { detail: oneLine(decision.detail) }),
  };
  try {
    const send = deps.receipt ?? (async (p: ReceiptPayload) => (await import("../../../packages/rt-client/src/client.ts")).agentPolicyReceipt(p));
    const reply = await send(payload);
    if (isRecord(reply) && reply.ok === false) log("the daemon did not record a Codex policy hook's receipt", { error: reply.error, event: hook.event });
  } catch (err) {
    log("a Codex policy hook's receipt could not reach the daemon", { err: err instanceof Error ? err.message : String(err), event: hook.event });
  }
}

/** Exactly the binding the thread id and profile name; a pane, a cwd or an environment variable never picks one. */
async function bindingResolver(): Promise<(native: NativeSessionRef) => Outcome<CallerContext>> {
  const { resolveCallerContextNow } = await import("../context.ts");
  return (native) => resolveCallerContextNow({ native });
}

/**
 * One native hook run: Codex's stdin payload in, the native exit code and
 * streams out. Never throws; whatever cannot be decided passes.
 */
export async function handleCodexHook(input: unknown, deps: CodexHookDeps = {}): Promise<CodexHookResult> {
  const log = deps.log ?? logToWarnings;
  const parsed = parseCodexHook(input, deps.event);
  if (!parsed.ok) {
    log("a Codex policy hook got a payload it could not read, so it decided nothing", { reason: parsed.error.message });
    return CODEX_HOOK_PASS;
  }
  const hook = parsed.data;
  try {
    const enabled = deps.enabled ?? (await import("../switch.ts")).integrationsEnabled;
    if (!enabled()) return CODEX_HOOK_PASS;
    const env = deps.env ?? process.env;
    // The decision keys on the payload's thread alone: an app server serving several threads, or a hook started
    // from inside a Codex shell, can carry another thread's id, and that must never switch enforcement off.
    const thread = env.CODEX_THREAD_ID;
    const threadEnv: CodexThreadEnv = typeof thread !== "string" || thread === "" ? "absent" : thread === hook.sessionId ? "same" : "other";
    if (threadEnv === "other") log("a Codex policy hook runs in a process naming another thread; it decides for the payload's thread", { thread, session: hook.sessionId });
    const profile = canonicalCodexProfile(undefined, env);
    const native: NativeSessionRef = { harness: "codex", profile, kind: "id", value: hook.sessionId };
    const context = (deps.resolve ?? (await bindingResolver()))(native);
    if (!context.ok) return CODEX_HOOK_PASS;

    // Any other tool is allowed, but still receipted: a check turn is unproven unless every run of rt's hook has its receipt.
    if (hook.event === "PreToolUse" && hook.tool !== CODEX_QUESTION_TOOL) {
      await sendReceipt(hook, profile, threadEnv, { verdict: "allow" }, deps, log);
      return CODEX_HOOK_PASS;
    }
    const decision = hook.event === "Stop"
      ? await decideStop(context.data, hook, deps, deps.stops ?? fileStopCounter(join((await import("../../rt-paths.ts")).rtDir(), "codex-policy", "stop-continuations")))
      : await decideAsk(context.data, hook, deps);
    if (decision.verdict === "escaped") log("a Codex session's Stop was let through after repeated continuations", { session: hook.sessionId, turn: hook.turnId, detail: decision.detail });
    await sendReceipt(hook, profile, threadEnv, decision, deps, log);
    if (decision.feedback === undefined) return CODEX_HOOK_PASS;
    return { exitCode: 2, stdout: "", stderr: bounded(decision.feedback) };
  } catch (err) {
    log("a Codex policy hook failed, so it decided nothing", { err: err instanceof Error ? err.message : String(err), event: hook.event });
    return CODEX_HOOK_PASS;
  }
}

// ─── Adapter (inspection and the session check) ──────────────────────────────

export type CodexPolicyInspectDeps = {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
  /** The sha256 of the hook executable's bytes. */
  fingerprint?: (path: string) => string;
  folderTrust?: typeof codexFolderTrust;
  now?: () => number;
};

export type CodexPolicyChecker = Pick<CodexSessionAdapter, "policyCheck">;

export type CodexPolicyDeps = CodexPolicyInspectDeps & {
  /** The live connection's session check, or undefined while rt has no connection to the app server. */
  checker?: () => Promise<CodexPolicyChecker | undefined>;
  receipts?: CodexPolicyReceipts;
  sleep?: (ms: number) => Promise<void>;
  checkTimeoutMs?: number;
};

type Located = { event: CodexPolicyEvent; sourcePath: string; group: number; handler: number; executable: string; installationId: string; entry: unknown; groupKeys: string[] };
/** `manifest` is the revision a receipt from these hooks names; `sourcePath` is set when both entries live in one hooks file. */
type Inspection = { revision: string; installation: string; manifest: string; sourcePath?: string };

/**
 * The whole input of a check turn: one harmless shell command, which runs
 * the manifest's unfiltered PreToolUse entry, and an end, which runs its
 * Stop entry. It asks no question and touches nothing.
 */
export const CODEX_POLICY_CHECK_PROMPT = "This is rt's policy check. Run the shell command `true` exactly once, then reply DONE and nothing else.";

/** Hook evidence trails the turn's end (a receipt crosses the socket, hook/completed follows the hook's exit), so it is polled for briefly. */
const EVIDENCE_POLL_MS = 100;
const EVIDENCE_POLLS = 30;

/** The capability each native event's hook enforces. */
const EVENT_CAPABILITY: Record<CodexPolicyEvent, Capability> = { PreToolUse: "gate-policy", Stop: "continuation-policy" };

const SNAKE: Record<CodexPolicyEvent, string> = { PreToolUse: "pre_tool_use", Stop: "stop" };

export { CODEX_PROVEN_POLICY };
const POLICY_CAPABILITIES: readonly Capability[] = ["gate-policy", "continuation-policy"];

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The folders from `cwd` up to its checkout's top level, where Codex looks for a project `.codex` layer. */
function projectLayers(cwd: string): string[] {
  const dirs: string[] = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    dirs.push(dir);
    let top = false;
    try {
      statSync(join(dir, ".git"));
      top = true;
    } catch { /* not this checkout's top level */ }
    if (top || dirname(dir) === dir) return top ? dirs : [cwd];
  }
}

function locate(sourcePath: string, text: string): Located[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const hooks = isRecord(parsed) && isRecord(parsed.hooks) ? parsed.hooks : {};
  const found: Located[] = [];
  for (const event of CODEX_POLICY_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    groups.forEach((group: unknown, g: number) => {
      const handlers = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
      handlers.forEach((handler: unknown, h: number) => {
        const command = isRecord(handler) && typeof handler.command === "string" ? parseCodexPolicyHookCommand(handler.command) : null;
        if (command && command.event === event) {
          found.push({
            event, sourcePath, group: g, handler: h, executable: command.executable, installationId: command.installationId,
            entry: handler, groupKeys: isRecord(group) ? Object.keys(group) : [],
          });
        }
      });
    });
  }
  return found;
}

function sameHandler(a: unknown, b: CodexHookHandler): boolean {
  if (!isRecord(a)) return false;
  const keys = Object.keys(a).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort())
    && a.type === b.type && a.command === b.command && a.timeout === b.timeout;
}

function trustedHash(config: Record<string, unknown>, located: Located): string | undefined {
  const state = isRecord(config.hooks) && isRecord(config.hooks.state) ? config.hooks.state : {};
  for (const path of new Set([located.sourcePath, realOr(located.sourcePath)])) {
    const entry = state[`${path}:${SNAKE[located.event]}:${located.group}:${located.handler}`];
    if (isRecord(entry) && entry.enabled !== false && typeof entry.trusted_hash === "string" && entry.trusted_hash !== "") return entry.trusted_hash;
  }
  return undefined;
}

function inspect(cwd: string, profile: string, deps: Required<CodexPolicyInspectDeps>): Outcome<Inspection> {
  const located: Located[] = [];
  for (const dir of projectLayers(cwd)) {
    const sourcePath = join(dir, ".codex", "hooks.json");
    let text: string;
    try {
      text = deps.readFile(sourcePath);
    } catch {
      continue;
    }
    located.push(...locate(sourcePath, text));
  }
  for (const event of CODEX_POLICY_EVENTS) {
    const n = located.filter((l) => l.event === event).length;
    if (n === 0) return fail("not-ready", `no project .codex layer for ${cwd} installs rt's ${event} policy hook`);
    if (n > 1) return fail("not-ready", `more than one ${event} policy hook is installed for ${cwd}, so rt cannot tell which one Codex trusts`);
  }
  const [first] = located;
  if (located.some((l) => l.executable !== first!.executable || l.installationId !== first!.installationId)) {
    return fail("not-ready", "the installed policy hooks name different executables or installations");
  }
  const manifest = codexPolicyManifest({ executable: first!.executable, installationId: first!.installationId });
  for (const l of located) {
    const expected = manifest.hooks[l.event][0]!.hooks[0]!;
    if (!sameHandler(l.entry, expected) || l.groupKeys.some((k) => k !== "hooks")) {
      return fail("not-ready", `the installed ${l.event} policy hook differs from the reviewed manifest`);
    }
  }

  const configPath = codexConfigPath(profile, deps.env);
  if (configPath === undefined) return fail("not-ready", "rt cannot find this Codex profile's settings, so it cannot read hook trust");
  const root = dirname(dirname(first!.sourcePath));
  const folder = deps.folderTrust(configPath, root);
  if (!folder.ok) return fail("not-ready", folder.error.message);
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = Bun.TOML.parse(deps.readFile(configPath));
    config = isRecord(parsed) ? parsed : {};
  } catch (err) {
    return fail("not-ready", `Codex's settings could not be read for hook trust: ${err instanceof Error ? err.message : String(err)}`);
  }
  const trusted: string[] = [];
  for (const l of located) {
    const hash = trustedHash(config, l);
    if (hash === undefined) return fail("not-ready", `Codex has not trusted rt's ${l.event} policy hook in ${l.sourcePath}`);
    trusted.push(`${l.event}:${l.sourcePath}:${l.group}:${l.handler}:${hash}`);
  }
  let executable: string;
  try {
    executable = deps.fingerprint(first!.executable);
  } catch {
    return fail("not-ready", `the policy hook's executable ${first!.executable} could not be read`);
  }
  const revision = createHash("sha256")
    .update(JSON.stringify({ manifest: manifest.revision, trusted: trusted.sort(), executable, profile }))
    .digest("hex");
  const sources = new Set(located.map((l) => l.sourcePath));
  return {
    ok: true,
    data: {
      revision, installation: first!.installationId, manifest: manifest.revision,
      ...(sources.size === 1 && { sourcePath: first!.sourcePath }),
    },
  };
}

function healthProblem(receipt: CodexPolicyReceipt, found: Inspection): string | undefined {
  if (receipt.installation !== found.installation) return "its hook belongs to another installation than the one installed here";
  if (receipt.revision !== found.manifest) return "its hook ran another hook revision than the one installed (an old loaded worker, or a changed executable)";
  if (receipt.verdict === "unavailable") return "the session's workflow policy could not decide";
  if (receipt.verdict === "escaped") return "a stop was let through after repeated continuations";
  return undefined;
}

async function liveChecker(): Promise<CodexPolicyChecker | undefined> {
  const sessions = await (await import("./sessions.ts")).loadCodexSessions();
  return "policyCheck" in sessions ? sessions as CodexSessionAdapter : undefined;
}

/**
 * Prepare only reads: the project's hook definitions, Codex's folder and
 * hook trust for them, and the executable's bytes. The native hash Codex
 * trusted cannot be recomputed here, so inspection alone never proves a
 * session; verify needs the session's own hooks to have run.
 *
 * A new session proves it in one check turn: rt issues a nonce for that
 * turn, and each event (PreToolUse, then Stop) must show exactly one
 * receipt from rt's hook and one native run from the inspected hooks file,
 * naming the manifest revision of the inspected executable and a verdict
 * the policy service reached. A resumed session keeps the proof an earlier
 * attachment earned only while the hooks are unchanged and its hooks have
 * been seen running since it resumed; no check turn is started for it unless
 * its caller agreed to one. Every resume is a new attachment generation and
 * the launcher verifies right after binding it, when no hook has run under
 * that generation yet, so such a session is not ready at first: it becomes
 * ready only when the same launch reservation is retried after both hooks
 * ran under the new generation. A new reservation is another resume, a new
 * generation, and starts unready again. `retainedFrom` always names the
 * generation whose check turn earned the proof, however many resumes kept
 * it. The verified capabilities are what the session
 * proved; whether Codex may be required to enforce them is prepare's
 * CODEX_PROVEN_POLICY.
 */
export function createCodexPolicy(overrides: CodexPolicyDeps = {}): PolicyAdapter {
  const deps: Required<CodexPolicyDeps> = {
    env: overrides.env ?? process.env,
    readFile: overrides.readFile ?? ((path) => readFileSync(path, "utf8")),
    fingerprint: overrides.fingerprint ?? ((path) => createHash("sha256").update(readFileSync(path)).digest("hex")),
    folderTrust: overrides.folderTrust ?? codexFolderTrust,
    now: overrides.now ?? Date.now,
    checker: overrides.checker ?? liveChecker,
    receipts: overrides.receipts ?? codexPolicyReceipts(),
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    checkTimeoutMs: overrides.checkTimeoutMs ?? CODEX_POLICY_CHECK_TURN_TIMEOUT_MS,
  };
  const profileOf = () => canonicalCodexProfile(undefined, deps.env);

  async function checkTurn(binding: SessionBinding, found: Inspection): Promise<Outcome<PolicyProof>> {
    const sourcePath = found.sourcePath;
    if (sourcePath === undefined) return fail("not-ready", "rt's policy hooks are split across project layers, so one check turn cannot prove them");
    let checker: CodexPolicyChecker | undefined;
    try {
      checker = await deps.checker();
    } catch (err) {
      return fail("not-ready", `rt could not reach the Codex app server to check the session's hooks: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!checker) return fail("not-ready", "rt has no live connection to the Codex app server, so the session's hooks cannot be checked");
    const { key, attachment: { generation } } = binding;
    let nonce: string | undefined;
    const complete = () => {
      const p = deps.receipts.proof(key, generation);
      return p !== null && p.nonce === nonce && CODEX_POLICY_EVENTS.every((e) => p.events[e] !== undefined);
    };
    let ran: Outcome<{ turnId: string; status: string }>;
    try {
      ran = await checker.policyCheck(binding, {
        prompt: CODEX_POLICY_CHECK_PROMPT,
        timeoutMs: deps.checkTimeoutMs,
        issue: (turnId) => { nonce = deps.receipts.issueDiagnostic(key, generation, turnId, sourcePath); },
        settle: async () => {
          for (let i = 0; i < EVIDENCE_POLLS && !complete(); i++) await deps.sleep(EVIDENCE_POLL_MS);
        },
      });
    } catch (err) {
      ran = fail("not-ready", err instanceof Error ? err.message : String(err));
    }
    if (!ran.ok) return fail(ran.error.code === "stale-binding" ? "stale-binding" : "not-ready", `the policy check turn did not run: ${ran.error.message}`);
    if (ran.data.status !== "completed") return fail("not-ready", `the policy check turn ended ${ran.data.status}`);
    const proof = deps.receipts.proof(key, generation);
    if (!proof || nonce === undefined || proof.nonce !== nonce || proof.turnId !== ran.data.turnId) {
      return fail("not-ready", "the policy check turn's evidence was replaced before rt read it");
    }
    const runs: Partial<Record<CodexPolicyEvent, string>> = {};
    for (const event of CODEX_POLICY_EVENTS) {
      const seen = proof.events[event];
      if (!seen) {
        return fail("not-ready", `the session's ${event} policy hook did not run from ${sourcePath} in its check turn with exactly one receipt and one native run`);
      }
      const problem = healthProblem(seen.receipt, found);
      if (problem) return fail("not-ready", `the session's ${event} check failed: ${problem}`);
      runs[event] = seen.run;
    }
    return {
      ok: true,
      data: {
        sessionKey: key, generation, revision: found.revision, observedAt: deps.now(), kind: "receipts",
        verified: CODEX_POLICY_EVENTS.map((e) => EVENT_CAPABILITY[e]),
        evidence: { turnId: proof.turnId, nonce, sourcePath, manifest: found.manifest, runs: { PreToolUse: runs.PreToolUse!, Stop: runs.Stop! } },
      },
    };
  }

  function retainedProof(binding: SessionBinding, found: Inspection, retained: PolicyProof | undefined): Outcome<PolicyProof> {
    const session = binding.native.value;
    if (!retained || retained.kind !== "receipts" || retained.sessionKey !== binding.key || !retained.evidence) {
      return fail("not-ready", `session ${session} resumed with no policy proof of its own to keep, so it stays unavailable for managed work until a check is agreed for it`);
    }
    if (retained.revision !== found.revision || retained.evidence.manifest !== found.manifest) {
      return fail("not-ready", `the Codex policy hooks changed since session ${session} proved them, so its proof cannot be kept`);
    }
    const sourcePath = found.sourcePath;
    const seen = deps.receipts.list(binding.key, binding.attachment.generation);
    const problem = seen.map((r) => healthProblem(r, found)).find((p) => p !== undefined);
    if (problem) return fail("not-ready", `since session ${session} resumed, ${problem}`);
    for (const event of CODEX_POLICY_EVENTS) {
      const healthy = sourcePath !== undefined && seen.some((r) => r.event === event && r.turn === "current" && r.threadEnv === "absent"
        && deps.receipts.ran(r, sourcePath));
      if (!healthy) return fail("not-ready", `session ${session} has not shown its ${event} policy hook running since it resumed`);
    }
    return {
      ok: true,
      data: {
        sessionKey: binding.key, generation: binding.attachment.generation, revision: found.revision, observedAt: deps.now(),
        kind: "receipts", verified: [...retained.verified],
        evidence: { ...retained.evidence, retainedFrom: retained.evidence.retainedFrom ?? retained.generation },
      },
    };
  }

  return {
    async prepare(request: LaunchRequest): Promise<Outcome<PreparedPolicy>> {
      const profile = profileOf();
      const found = inspect(request.cwd, profile, deps);
      if (!found.ok) return found;
      const proven: readonly Capability[] = CODEX_PROVEN_POLICY[request.mode];
      const missing = request.required.filter((c) => POLICY_CAPABILITIES.includes(c) && !proven.includes(c));
      if (missing.length > 0) {
        return fail("not-ready", `Codex's policy hooks are installed, but rt has not proved they enforce ${missing.join(", ")} in ${request.mode} sessions`);
      }
      return {
        ok: true,
        data: { id: `codex-policy-${found.data.revision.slice(0, 16)}`, harness: "codex", profile, cwd: request.cwd, revision: found.data.revision },
      };
    },

    async verify(binding: SessionBinding, prepared: PreparedPolicy, context: PolicyVerifyContext = { kind: "launch" }) {
      if (binding.native.harness !== "codex" || prepared.harness !== "codex") {
        return fail("invalid", "the Codex policy verifies only a Codex session prepared by it");
      }
      if (binding.native.profile !== prepared.profile) return fail("invalid", "the session belongs to another Codex profile than the prepared policy");
      const found = inspect(prepared.cwd, prepared.profile, deps);
      if (!found.ok) return found;
      if (found.data.revision !== prepared.revision) return fail("not-ready", "the Codex policy hooks changed after they were prepared");
      if (context.kind === "resume" && context.check !== true) return retainedProof(binding, found.data, context.retained);
      return checkTurn(binding, found.data);
    },
  };
}
