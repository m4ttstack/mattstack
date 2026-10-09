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
import type { LaunchRequest, PolicyAdapter, PreparedPolicy } from "../contracts.ts";
import type { PolicyDeps } from "../policy.ts";
import {
  CODEX_POLICY_EVENTS, MAX_ID_LENGTH, MAX_PATH_LENGTH, codexPolicyManifest, parseCodexPolicyHookCommand, plainText,
  validInstallationId, type CodexHookHandler, type CodexPolicyEvent,
} from "./hook-manifest.ts";
import type { CodexHookVerdict, CodexThreadEnv, ReceiptPayload } from "./policy-receipts.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { isRecord } from "./protocol.ts";
import { codexConfigPath, codexFolderTrust } from "./trust.ts";

// ─── Native payload ──────────────────────────────────────────────────────────

/** The native tool that opens a question; Codex's spelling of Claude's AskUserQuestion. */
export const CODEX_QUESTION_TOOL = "request_user_input";

export type CodexHookEvent = { event: CodexPolicyEvent; sessionId: string; turnId: string; cwd: string; tool?: string };

function fail<T>(code: "invalid" | "not-ready", message: string): Outcome<T> {
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
 * Claude Code lets a turn end after eight consecutive Stop blocks, and the
 * shared Stop rule relies on that cap as its loop guard (pipeline-gate-stop.sh
 * does not honour stop_hook_active). Codex keeps a continued Stop inside the
 * same turn, so the same cap is counted here per thread and turn.
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
  /** The executable the definition runs, for the manifest revision a receipt carries. */
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
 * The manifest revision this hook belongs to. Run from source, process.execPath
 * is bun rather than the rt the manifest names, so M6c compares receipt
 * revisions against manifest revisions, never against PreparedPolicy.revision.
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
  const revision = revisionOf(deps.executable ?? process.execPath, installation);
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

// ─── Adapter (read-only inspection) ──────────────────────────────────────────

export type CodexPolicyInspectDeps = {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
  /** The sha256 of the hook executable's bytes. */
  fingerprint?: (path: string) => string;
  folderTrust?: typeof codexFolderTrust;
  now?: () => number;
};

type Located = { event: CodexPolicyEvent; sourcePath: string; group: number; handler: number; executable: string; installationId: string; entry: unknown; groupKeys: string[] };
type Inspection = { revision: string; installation: string };

const SNAKE: Record<CodexPolicyEvent, string> = { PreToolUse: "pre_tool_use", Stop: "stop" };

/**
 * Policy capabilities the Codex hooks are proven to enforce. Empty: the
 * asynchronous question path is not intercepted by the tested hook, and
 * Codex's answer to repeated Stop refusals is not characterized, so neither
 * capability is advertised until live checks prove both.
 */
export const CODEX_PROVEN_POLICY: readonly Capability[] = [];
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
  return { ok: true, data: { revision, installation: first!.installationId } };
}

/**
 * Prepare and verify only read: the project's hook definitions, Codex's
 * folder and hook trust for them, and the executable's bytes. The native
 * hash Codex trusted cannot be recomputed here, so a trusted entry whose
 * definition changed passes inspection; only a receipt from the hook
 * actually running proves it loads.
 */
export function createCodexPolicy(overrides: CodexPolicyInspectDeps = {}): PolicyAdapter {
  const deps: Required<CodexPolicyInspectDeps> = {
    env: overrides.env ?? process.env,
    readFile: overrides.readFile ?? ((path) => readFileSync(path, "utf8")),
    fingerprint: overrides.fingerprint ?? ((path) => createHash("sha256").update(readFileSync(path)).digest("hex")),
    folderTrust: overrides.folderTrust ?? codexFolderTrust,
    now: overrides.now ?? Date.now,
  };
  const profileOf = () => canonicalCodexProfile(undefined, deps.env);

  return {
    async prepare(request: LaunchRequest): Promise<Outcome<PreparedPolicy>> {
      const profile = profileOf();
      const found = inspect(request.cwd, profile, deps);
      if (!found.ok) return found;
      const missing = request.required.filter((c) => POLICY_CAPABILITIES.includes(c) && !CODEX_PROVEN_POLICY.includes(c));
      if (missing.length > 0) {
        return fail("not-ready", `Codex's policy hooks are installed, but rt has not proved they enforce ${missing.join(", ")} for every native path`);
      }
      return {
        ok: true,
        data: { id: `codex-policy-${found.data.revision.slice(0, 16)}`, harness: "codex", profile, cwd: request.cwd, revision: found.data.revision },
      };
    },

    async verify(binding: SessionBinding, prepared: PreparedPolicy) {
      if (binding.native.harness !== "codex" || prepared.harness !== "codex") {
        return fail("invalid", "the Codex policy verifies only a Codex session prepared by it");
      }
      if (binding.native.profile !== prepared.profile) return fail("invalid", "the session belongs to another Codex profile than the prepared policy");
      const found = inspect(prepared.cwd, prepared.profile, deps);
      if (!found.ok) return found;
      if (found.data.revision !== prepared.revision) return fail("not-ready", "the Codex policy hooks changed after they were prepared");
      return {
        ok: true,
        data: {
          sessionKey: binding.key, generation: binding.attachment.generation, revision: found.data.revision,
          verified: [...CODEX_PROVEN_POLICY], observedAt: deps.now(),
        },
      };
    },
  };
}
