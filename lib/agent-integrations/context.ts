/**
 * Caller context: which session binding a CLI or MCP call comes from.
 *
 * Evidence is built at the process or transport boundary, never from tool
 * arguments, and only a native session reference or a connection-bound
 * session key can name a caller. Pane, process, working directory and a
 * requested herd job ride along as hints: they never pick a binding, so a
 * call that carries nothing else refuses as ambiguous. A Claude session's live
 * mod link is a hint of the same kind: with the switch on, its pane may pick
 * one of the bindings a native claim already matches, and a disagreement with
 * the resolved binding is logged, never acted on.
 *
 * Each harness has its own extractor. Codex names a CLI caller by
 * CODEX_THREAD_ID and an MCP caller by the host's per-request
 * `_meta.threadId`; its shared MCP process environment names no thread.
 * Claude names both by CLAUDE_CODE_SESSION_ID in the process environment,
 * the mechanism rt has always used, with no profile the server can observe.
 */

import type { Database } from "bun:sqlite";
import type {
  CallerContext, FaultCode, HarnessId, NativeSessionRef, Outcome, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { getAgent } from "../state/agents-store.ts";
import { getStateDb } from "../state/db.ts";
import { modContext, type ModContextHint } from "./claude/mod-path.ts";
import { canonicalCodexProfile } from "./codex/profile.ts";
import { resolveLegacySession } from "./legacy.ts";
import { createSessionStore, isDetachedAttachment, listBindingsByNativeValue } from "./session-store.ts";
import { integrationsEnabled } from "./switch.ts";

export { integrationsEnabled };

/** A native reference whose profile the boundary may not be able to observe. */
export type NativeClaim = Omit<NativeSessionRef, "profile"> & { profile?: string };

export type CallerEvidence = {
  native?: NativeClaim;
  /** An id the caller named explicitly, with no harness: resolved only when exactly one record matches. */
  raw?: string;
  connection?: { key: string; generation: number };
  hints?: { pane?: string; pid?: number; cwd?: string };
  requested?: { herd?: string; job?: string };
};

/** What the MCP server's own launch configuration says about its host. */
export type McpTransport = { harness?: HarnessId; profile?: string };

export type ResolveDeps = {
  db?: Database;
  legacy?: typeof resolveLegacySession;
  /** The live mod link's record for a Claude session id; only the daemon holds links. */
  modContext?: (nativeId: string) => ModContextHint | null;
  enabled?: () => boolean;
  log?: (message: string, context: Record<string, unknown>) => void;
};

/** The cause and the remedy when one environment names both a Codex thread and a Claude Code session. */
export const BOTH_SESSIONS_MESSAGE = "this command's environment names both a Codex thread (CODEX_THREAD_ID) and a Claude Code session "
  + "(CLAUDE_CODE_SESSION_ID), so rt cannot tell which one is calling. The Codex app server most likely inherited a Claude Code "
  + "session's environment: restart the Codex app server from a plain shell, outside any Claude Code session";

function fail<T>(code: FaultCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The Codex home is the profile: two homes hold separate thread stores. The session adapter binds under the same string. */
export function codexProfile(env: NodeJS.ProcessEnv): string {
  return canonicalCodexProfile(undefined, env);
}

function hintsFrom(env: NodeJS.ProcessEnv, pid?: number): Pick<CallerEvidence, "hints" | "requested"> {
  const hints: NonNullable<CallerEvidence["hints"]> = {};
  if (text(env.HERDR_PANE_ID)) hints.pane = env.HERDR_PANE_ID;
  if (pid !== undefined) hints.pid = pid;
  const requested: NonNullable<CallerEvidence["requested"]> = {};
  if (text(env.HERD_ID)) requested.herd = env.HERD_ID;
  if (text(env.HERD_JOB)) requested.job = env.HERD_JOB;
  return {
    ...(Object.keys(hints).length > 0 && { hints }),
    ...(Object.keys(requested).length > 0 && { requested }),
  };
}

function flagValue(args: string[], flag: string): { value?: string; missing: boolean } {
  const i = args.indexOf(flag);
  if (i < 0) return { missing: false };
  const value = args[i + 1];
  return value === undefined || value.startsWith("--") ? { missing: true } : { value, missing: false };
}

/** Only Codex is proven to name its caller per request, so only Codex may be declared. */
export function mcpTransportFromArgs(args: string[], env: NodeJS.ProcessEnv): Outcome<McpTransport> {
  const harness = flagValue(args, "--harness");
  const profile = flagValue(args, "--profile");
  if (harness.missing || profile.missing) return fail("invalid", "--harness and --profile each take a value");
  if (harness.value === undefined) {
    return profile.value === undefined ? { ok: true, data: {} } : fail("invalid", "--profile needs --harness");
  }
  if (harness.value !== "codex") return fail("unsupported", `no ${harness.value} host is supported for per-call attribution`);
  return { ok: true, data: { harness: "codex", profile: canonicalCodexProfile(profile.value, env) } };
}

function codexMcpClaim(meta: unknown, env: NodeJS.ProcessEnv, profile: string): Outcome<NativeClaim | undefined> {
  const thread = meta !== null && typeof meta === "object" ? (meta as Record<string, unknown>).threadId : undefined;
  if (thread === undefined) return { ok: true, data: undefined };
  if (!text(thread)) return fail("invalid", "the host sent a thread id that is not a non-empty string");
  if (text(env.CODEX_THREAD_ID) && env.CODEX_THREAD_ID !== thread) {
    return fail("ambiguous", "the host's thread id disagrees with the thread this server was started in");
  }
  return { ok: true, data: { harness: "codex", profile, kind: "id", value: thread } };
}

/** After /clear the MCP process still carries the pre-clear id; once the Claude session adapter observes the clear and detaches that binding, the id no longer resolves to it. */
function claudeEnvClaim(env: NodeJS.ProcessEnv): NativeClaim | undefined {
  return text(env.CLAUDE_CODE_SESSION_ID)
    ? { harness: "claude", kind: "id", value: env.CLAUDE_CODE_SESSION_ID }
    : undefined;
}

/** `meta` is the request's own `params._meta`; tool arguments never reach this function. */
export function extractMcpEvidence(meta: unknown, env: NodeJS.ProcessEnv, transport: McpTransport): Outcome<CallerEvidence> {
  const extra = hintsFrom(env);
  if (transport.harness === "codex") {
    const claim = codexMcpClaim(meta, env, transport.profile ?? codexProfile(env));
    if (!claim.ok) return claim;
    return { ok: true, data: { ...(claim.data && { native: claim.data }), ...extra } };
  }
  const native = claudeEnvClaim(env);
  return { ok: true, data: { ...(native && { native }), ...extra } };
}

/** `--session <id>` stays the explicit override, as in currentSessionId. */
export function extractCliEvidence(args: string[], env: NodeJS.ProcessEnv): Outcome<CallerEvidence> {
  const extra = hintsFrom(env, process.pid);
  const explicit = flagValue(args, "--session").value;
  if (text(explicit)) return { ok: true, data: { raw: explicit, ...extra } };
  const codexThread = text(env.CODEX_THREAD_ID) ? env.CODEX_THREAD_ID : undefined;
  const claude = claudeEnvClaim(env);
  if (codexThread && claude) return fail("ambiguous", BOTH_SESSIONS_MESSAGE);
  const native: NativeClaim | undefined = codexThread
    ? { harness: "codex", profile: codexProfile(env), kind: "id", value: codexThread }
    : claude;
  return { ok: true, data: { ...(native && { native }), ...extra } };
}

/** A detached binding grants nothing; a Claude caller's own environment falls back to the environment path (unboundClaudeCaller). */
function resolvedAs(binding: SessionBinding): Outcome<CallerContext> {
  if (isDetachedAttachment(binding)) {
    return fail("stale-binding", `${binding.native.harness} session ${binding.native.value} left its attachment (a /clear, a fork, or a resume elsewhere), so it no longer names a bound session`);
  }
  return { ok: true, data: { binding } };
}

function sameSession(claim: NativeClaim, native: NativeSessionRef): boolean {
  return claim.harness === native.harness && claim.kind === native.kind && claim.value === native.value
    && (claim.profile === undefined || claim.profile === native.profile);
}

/** A thrown legacy read (a malformed old row) is an unattributed caller, not a failed tool call. */
function legacyLookup(deps: ResolveDeps, db: Database, raw: string, harness?: HarnessId): Outcome<SessionBinding> {
  try {
    return (deps.legacy ?? resolveLegacySession)(raw, harness, db);
  } catch {
    return fail("ambiguous", `session ${raw} cannot be attributed: its older records could not be read`);
  }
}

function byConnection(db: Database, input: CallerEvidence & { connection: { key: string; generation: number } }): Outcome<CallerContext> {
  const binding = createSessionStore(db).get(input.connection.key);
  if (!binding) return fail("ambiguous", "this connection's session is no longer recorded");
  if (binding.attachment.generation !== input.connection.generation) {
    return fail("stale-binding", `this connection belongs to attachment ${input.connection.generation} of its session, which has since moved to ${binding.attachment.generation}`);
  }
  if (input.native && !sameSession(input.native, binding.native)) {
    return fail("ambiguous", "this call names a different session than its connection");
  }
  return resolvedAs(binding);
}

function logModHint(message: string, context: Record<string, unknown>): void {
  void import("../ui/warn.ts").then(({ warn }) => warn("caller-context", message, { context }));
}

/** A Claude session's live mod link, read only with the switch on, so a switched-off resolve never consults one. */
function linkHint(claim: NativeClaim, deps: ResolveDeps): ModContextHint | null {
  if (claim.harness !== "claude" || claim.kind !== "id") return null;
  const hint = (deps.modContext ?? modContext)(claim.value);
  return hint && (deps.enabled ?? integrationsEnabled)() ? hint : null;
}

/** The link's pane picks one of the bindings the claim already matches, or none; it never names a binding on its own. */
function choose(matches: SessionBinding[], hint: ModContextHint | null): SessionBinding | undefined {
  if (hint?.pane === undefined) return undefined;
  const held = matches.filter((b) => !isDetachedAttachment(b) && b.attachment.pane === hint.pane);
  return held.length === 1 ? held[0] : undefined;
}

/** A binding whose recorded pane disagrees with its live link's is still the caller; the disagreement is only logged. */
function noted(outcome: Outcome<CallerContext>, hint: ModContextHint | null, deps: ResolveDeps): Outcome<CallerContext> {
  const pane = outcome.ok ? outcome.data.binding.attachment.pane : undefined;
  if (hint?.pane !== undefined && pane !== undefined && hint.pane !== pane) {
    (deps.log ?? logModHint)("a Claude session's mod link names another pane than its binding; the binding stands", {
      session: hint.sessionId, link: hint.linkId, bindingPane: pane, linkPane: hint.pane,
    });
  }
  return outcome;
}

function byNative(db: Database, claim: NativeClaim, deps: ResolveDeps): Outcome<CallerContext> {
  if (claim.profile !== undefined) {
    const hit = createSessionStore(db).find({ ...claim, profile: claim.profile });
    if (hit) return noted(resolvedAs(hit), linkHint(claim, deps), deps);
  } else {
    const matches = listBindingsByNativeValue(db, claim.value)
      .filter((b) => b.native.harness === claim.harness && b.native.kind === claim.kind);
    if (matches.length === 1) return noted(resolvedAs(matches[0]!), linkHint(claim, deps), deps);
    if (matches.length > 1) {
      const chosen = choose(matches, linkHint(claim, deps));
      if (chosen) return resolvedAs(chosen);
      return fail("ambiguous", `${claim.harness} session ${claim.value} is recorded under more than one profile`);
    }
  }
  const legacy = legacyLookup(deps, db, claim.value, claim.harness);
  if (!legacy.ok) return legacy;
  if (!sameSession(claim, legacy.data.native)) {
    return fail("ambiguous", `${claim.harness} session ${claim.value} is recorded under another profile`);
  }
  return resolvedAs(legacy.data);
}

/**
 * The binding a call comes from. A native miss falls back to the legacy
 * records once; nothing else (a pane, a job, a working directory, the
 * newest run) can stand in for a missing or contradicted reference.
 */
export async function resolveCallerContext(input: CallerEvidence, deps: ResolveDeps = {}): Promise<Outcome<CallerContext>> {
  return resolveCallerContextNow(input, deps);
}

/** The CLI's session lookup is synchronous, so it resolves through this. */
export function resolveCallerContextNow(input: CallerEvidence, deps: ResolveDeps = {}): Outcome<CallerContext> {
  if (!input.connection && !input.native && !text(input.raw)) {
    return fail("ambiguous", "no trusted session evidence came with this call; a pane, job or working directory does not identify a caller");
  }
  if (input.native && !text(input.native.value)) return fail("invalid", "a native session reference needs a value");
  const db = deps.db ?? getStateDb();
  if (input.connection) return byConnection(db, { ...input, connection: input.connection });
  if (input.native) return byNative(db, input.native, deps);
  const legacy = legacyLookup(deps, db, input.raw!);
  return legacy.ok ? resolvedAs(legacy.data) : legacy;
}

/**
 * A Claude Code session named by its own environment keeps the environment
 * path, with no binding and so no assignment, when it was never bound (until
 * it signs in there is no identity to bind it under) or when every binding of
 * it was detached (after a /clear the MCP process still carries the old id).
 * A bound Claude session, an explicit id and every Codex caller go through
 * bindings.
 */
function unboundClaudeCaller(input: CallerEvidence, outcome: Outcome<CallerContext>, deps: ResolveDeps): boolean {
  if (outcome.ok) return false;
  const claim = input.native;
  if (!claim || claim.harness !== "claude" || claim.profile !== undefined || input.connection || input.raw !== undefined) return false;
  const recorded = listBindingsByNativeValue(deps.db ?? getStateDb(), claim.value).filter((b) => b.native.harness === "claude");
  if (outcome.error.code === "ambiguous") return recorded.length === 0;
  return outcome.error.code === "stale-binding" && recorded.length > 0 && recorded.every(isDetachedAttachment);
}

/** resolveCallerContextNow, or null for an unbound Claude caller, which keeps its environment path. */
export function resolveCallerOrEnvironmentNow(input: CallerEvidence, deps: ResolveDeps = {}): Outcome<CallerContext> | null {
  const outcome = resolveCallerContextNow(input, deps);
  return unboundClaudeCaller(input, outcome, deps) ? null : outcome;
}

/** The MCP server's resolver: null tells a tool to act as its environment says, as it does with the switch off. */
export async function resolveToolCaller(input: CallerEvidence, deps: ResolveDeps = {}): Promise<Outcome<CallerContext> | null> {
  return resolveCallerOrEnvironmentNow(input, deps);
}

/**
 * The native session id a CLI command acts as. No session evidence at all
 * is a plain shell, which the chat verbs already handle without a session;
 * an unbound Claude session keeps its environment id; any other evidence
 * that does not resolve to one binding is refused. `bindingsOnly` refuses
 * the unbound Claude session too, for sign-in, which binds it.
 */
export function resolveCliSession(
  args: string[], env: NodeJS.ProcessEnv, deps: ResolveDeps = {}, opts: { bindingsOnly?: boolean } = {},
): Outcome<string | undefined> {
  const evidence = extractCliEvidence(args, env);
  if (!evidence.ok) return evidence;
  const { native, raw } = evidence.data;
  if (!native && raw === undefined) return { ok: true, data: undefined };
  const caller = opts.bindingsOnly ? resolveCallerContextNow(evidence.data, deps) : resolveCallerOrEnvironmentNow(evidence.data, deps);
  if (caller === null) return { ok: true, data: native!.value };
  return caller.ok ? { ok: true, data: caller.data.binding.native.value } : caller;
}

/** The binding a CLI command's own evidence names, or undefined for a plain shell or a session no live binding names. */
export function resolveCliBinding(args: string[], env: NodeJS.ProcessEnv, deps: ResolveDeps = {}): SessionBinding | undefined {
  const evidence = extractCliEvidence(args, env);
  if (!evidence.ok || (!evidence.data.native && evidence.data.raw === undefined)) return undefined;
  const caller = resolveCallerContextNow(evidence.data, deps);
  return caller.ok ? caller.data.binding : undefined;
}

/**
 * The agent and gate subject a bound Codex worker acts as, the session id the
 * daemon resolves them by, and the binding's own pane (the environment its
 * tools see belongs to the app server, so its pane variable is not the worker's).
 */
/** `harness` names the session's harness, so the gate's nudge never rings another harness's inbox. */
export type BoundGateIdentity = { agentId: string; subject: string; sessionId: string; pane?: string; harness: string };

/**
 * With agent.integrations.enabled on, a Codex worker's gate identity comes
 * from its binding: its tools run in the user-started app server, whose
 * environment never carries the RT_AGENT_ID and RT_GATE_SUBJECT a launch
 * stamps. Null when the switch is off, the caller is not a Codex thread, or
 * the thread is not a launched agent's bound session; those keep today's path.
 * An environment naming both harnesses' sessions refuses.
 */
export function boundCodexGateIdentity(
  env: NodeJS.ProcessEnv, deps: ResolveDeps & { enabled?: () => boolean } = {},
): Outcome<BoundGateIdentity | null> {
  if (!text(env.CODEX_THREAD_ID) || !(deps.enabled ?? integrationsEnabled)()) return { ok: true, data: null };
  if (text(env.CLAUDE_CODE_SESSION_ID)) return fail("ambiguous", BOTH_SESSIONS_MESSAGE);
  const db = deps.db ?? getStateDb();
  const caller = resolveCallerContextNow({ native: { harness: "codex", profile: codexProfile(env), kind: "id", value: env.CODEX_THREAD_ID } }, { ...deps, db });
  const agentId = caller.ok ? caller.data.binding.agentId : undefined;
  if (!caller.ok || agentId === undefined) return { ok: true, data: null };
  const rec = getAgent(agentId, db);
  return {
    ok: true,
    data: {
      agentId, subject: rec?.id === agentId && rec.subject !== undefined ? rec.subject : `agent:${agentId}`,
      sessionId: caller.data.binding.native.value,
      ...(caller.data.binding.attachment.pane !== undefined && { pane: caller.data.binding.attachment.pane }),
      harness: caller.data.binding.native.harness,
    },
  };
}
