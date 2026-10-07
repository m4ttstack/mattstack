/**
 * Claude Code's session integration: its native argv, launch and resume into
 * a herdr pane with the folder-trust check, discovery from Claude Code's
 * session registry, observations normalized from herdr and that registry,
 * and binding a manually started session when it signs in.
 *
 * rt mints a Claude session's id and hands it to Claude, so a launch knows
 * its native reference before the process starts. Claude names a caller only
 * through its process environment, which a /clear does not change, so a
 * binding whose session has left its attachment is marked detached here and
 * the caller resolver stops resolving it.
 *
 * Session uuids are validated in the argv builders because the claude CLI
 * fails soft: `--session-id ""` is silently ignored (random id minted) and
 * `-p --resume ""` silently resumes the most recent session in cwd
 * (spike 2026-08-25). A headless prompt never enters argv: the caller feeds it
 * on stdin, and a headless invocation without one is refused at build time.
 *
 * Two output shapes: argv arrays for daemon-side Bun.spawn (absolute bins ...
 * executable lookup uses the process-start PATH), and a single shell string
 * for `herdr pane run` (bare names ... the pane shell carries the login PATH).
 */

import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import type {
  FaultCode, Mode, NativeSessionRef, Observation, Outcome, Readiness, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import type { PaneAccount } from "../../../packages/rt-client/src/commands.ts";
import { parsePaneRef } from "../../../packages/rt-client/src/pane-ref.ts";
import { unsetPrefix, withoutEnv } from "../../agent-argv/env.ts";
import type { AgentInvocation } from "../../agent-argv/types.ts";
import { registryRoots, resolveAllInboxes, sessionForPid, type InboxBinding } from "../../claude-registry.ts";
import type { AgentEntry } from "../../runs/liveness.ts";
import { isAlive } from "../../runner/workspace-registry.ts";
import { isBusyError } from "../../state/busy.ts";
import type {
  LaunchHost, LaunchRequest, NativeLaunch, PreparedLaunch, RunWorkProcess, SessionAdapter, WorkReceipt,
} from "../contracts.ts";
import { openHostPane, type HostPaneLaunch, type HostPaneOpened } from "../herdr-pane.ts";
import {
  createSessionStore, isDetachedAttachment, LEGACY_DEFAULT_PROFILE, listBindingsByNativeValue, type AttachmentInput, type SessionStore,
} from "../session-store.ts";
import { CROSS_SESSION_INBOUND_SETTINGS, writeClaudeGateHookSettings } from "./hooks.ts";

export { CROSS_SESSION_INBOUND_SETTINGS };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function shellSingleQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export type ClaudeInvocation = AgentInvocation;

export function resolveClaudeBin(): string {
  return Bun.which("claude") ?? join(process.env.HOME ?? homedir(), ".local", "bin", "claude");
}

export function resolveCswapBin(): string {
  return Bun.which("cswap") ?? join(process.env.HOME ?? homedir(), ".local", "bin", "cswap");
}

function claudeArgs(inv: AgentInvocation): string[] {
  if (!isValidSessionUuid(inv.session.sessionId)) {
    throw new Error(`invalid session uuid "${inv.session.sessionId}" ... refusing to spawn`);
  }
  if (inv.headless && !inv.prompt) {
    throw new Error("headless launch requires a prompt (claude -p reads it from stdin)");
  }
  const args: string[] = [];
  if (inv.headless) args.push("-p", "--output-format", "json");
  if (inv.yolo) args.push("--dangerously-skip-permissions");
  if (inv.model) args.push("--model", inv.model);
  if (inv.effort) args.push("--effort", inv.effort);
  // Never `--name`: Claude Code paints a session name as the terminal title
  // for the pane's whole life; sign-in reads the reserved handle
  // off the agent record instead. Headless (-p) never signs into chat.
  // Never both --settings: a settingsPath caller has already folded this same
  // object into the file it points at (see CROSS_SESSION_INBOUND_SETTINGS).
  if (!inv.headless && inv.inboundAccept && !inv.settingsPath) {
    args.push("--settings", JSON.stringify(CROSS_SESSION_INBOUND_SETTINGS));
  }
  if (inv.settingsPath) args.push("--settings", inv.settingsPath);
  // --add-dir is variadic: the token right after its value must be another
  // flag, never the positional prompt, or claude would swallow the prompt as
  // one more directory to add.
  if (inv.addDirs) for (const dir of inv.addDirs) args.push("--add-dir", dir);
  if (inv.session.kind === "start") args.push("--session-id", inv.session.sessionId);
  else args.push("--resume", inv.session.sessionId);
  if (inv.extraArgs) args.push(...inv.extraArgs.split(/\s+/).filter(Boolean));
  // A headless prompt is the caller's stdin: `claude -p` reads it there.
  if (inv.prompt && !inv.headless) args.push(inv.prompt);
  return args;
}

export function buildClaudeArgv(inv: AgentInvocation, bins?: { claude?: string; cswap?: string }): string[] {
  const args = claudeArgs(inv);
  // claude args live only after "--"; the literal word "claude" is never
  // among them since cswap runs claude itself.
  if (inv.account) return [bins?.cswap ?? resolveCswapBin(), "run", inv.account, "--", ...args];
  return [bins?.claude ?? resolveClaudeBin(), ...args];
}

export function buildPaneCommand(cwd: string, inv: AgentInvocation): string {
  // Every token is single-quoted, including flag names (no allowlist), so a
  // prompt equal to a flag like "-p" is still treated as data.
  const quoted = claudeArgs(inv).map(shellSingleQuote);
  const head = inv.account ? `cswap run ${shellSingleQuote(inv.account)} --` : "claude";
  const env = Object.entries(inv.env ?? {}).map(([k, v]) => `${k}=${shellSingleQuote(v)}`);
  return `cd ${shellSingleQuote(cwd)} && ${unsetPrefix(inv.unsetEnv)}${[...env, head, ...quoted].join(" ")}`;
}

export type PaneLaunch = HostPaneLaunch;
export type PaneOpened = HostPaneOpened;

export type ClaudeRegistry = {
  roots(): string[];
  read(root: string): Map<string, InboxBinding>;
  /** The session the Claude process `pid` is on now, from its own registry file. */
  sessionForPid(pid: number): string | null;
};

export type ClaudeSessionDeps = {
  store(): SessionStore | Promise<SessionStore>;
  now(): number;
  mintId(): string;
  openPane(launch: PaneLaunch): Promise<Outcome<PaneOpened>>;
  /** Resolves with the folder-trust outcome the caller reports, when there is one. */
  acceptTrust(opened: PaneOpened, cwd: string, host?: LaunchHost): Promise<unknown>;
  /** Spawns a headless `claude -p` when the launch host brings no runner of its own. */
  spawn: RunWorkProcess;
  /** herdr's agent list; null when herdr could not be asked. */
  agents(): Promise<AgentEntry[] | null>;
  registry: ClaudeRegistry;
  processAlive(pid: number): boolean;
  socketExists(path: string): boolean;
  cswapAccounts(): Promise<PaneAccount[]>;
};

const HARNESS = "claude";
/** Paint budget for the folder-trust check on a freshly opened pane. */
const TRUST_PAINT_MS = 3_000;

const home = (): string => process.env.HOME ?? homedir();

const defaultRegistry: ClaudeRegistry = {
  roots: () => registryRoots(home()),
  read: (root) => resolveAllInboxes({ roots: [root] }),
  sessionForPid: (pid) => sessionForPid(pid, { roots: registryRoots(home()) }),
};

/** Every root read once; a pid's session comes from those same rows, so a pass never re-reads a file. */
function snapshotRegistry(registry: ClaudeRegistry): ClaudeRegistry {
  const roots = registry.roots();
  const reads = new Map(roots.map((root) => [root, registry.read(root)] as const));
  const byPid = new Map<number, string>();
  for (const rows of reads.values()) for (const [sessionId, row] of rows) if (!byPid.has(row.pid)) byPid.set(row.pid, sessionId);
  return {
    roots: () => roots,
    read: (root) => reads.get(root) ?? new Map(),
    sessionForPid: (pid) => byPid.get(pid) ?? null,
  };
}

function fail<T>(code: FaultCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const claudeRef = (profile: string, value: string): NativeSessionRef => ({ harness: HARNESS, profile, kind: "id", value });

function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

async function defaultCswapAccounts(): Promise<PaneAccount[]> {
  return (await import("../../cswap.ts")).listCswapAccounts();
}

function defaultDeps(): ClaudeSessionDeps {
  let store: SessionStore | undefined;
  return {
    store: async () => (store ??= createSessionStore((await import("../../state/db.ts")).getStateDb())),
    now: Date.now,
    mintId: () => crypto.randomUUID(),
    openPane: openHostPane,
    acceptTrust: async (opened, cwd, host) => {
      const [{ acceptTrustOnPane, cwdPath }, { herdrRequest }] = await Promise.all([
        import("../../daemon/trust-accept.ts"), import("../../herdr/client.ts"),
      ]);
      return acceptTrustOnPane({
        herdr: host?.herdr?.request ?? herdrRequest, sock: opened.socket ? { sockPath: opened.socket } : {},
        pane: parsePaneRef(opened.pane).paneId, ...(host?.log && { log: host.log }),
        context: { ...(host?.gate && { agent: host.gate.agentId }), cwd }, trustsPath: cwdPath(cwd),
        waitBudgetMs: host?.trustWaitMs ?? TRUST_PAINT_MS, ...host?.herdr?.trustBudgets,
      });
    },
    spawn: (argv, cwd, env, opts) => {
      const proc = Bun.spawn(argv as [string, ...string[]], {
        cwd,
        env: withoutEnv({ ...process.env, ...env }, opts.unset),
        stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      return { pid: proc.pid, exited: proc.exited, stdout: () => new Response(proc.stdout).text() };
    },
    agents: async () => (await import("../../runs/liveness.ts")).recentAgents(),
    registry: defaultRegistry,
    processAlive: isAlive,
    socketExists: existsSync,
    cswapAccounts: defaultCswapAccounts,
  };
}

/** cswap keeps each account's Claude config under ~/.claude-swap-backup/sessions/<number>-<name>/. */
async function profileForConfigDir(dir: string | undefined, accounts: () => Promise<PaneAccount[]>): Promise<string | undefined> {
  if (!text(dir) || basename(dirname(dir)) !== "sessions" || basename(dirname(dirname(dir))) !== ".claude-swap-backup") {
    return LEGACY_DEFAULT_PROFILE;
  }
  const slot = /^(\d+)-/.exec(basename(dir));
  if (!slot) return undefined;
  return (await accounts()).find((account) => account.slot === Number(slot[1]))?.email;
}

/** A session can have rows in more than one root (an old process's file can outlive it); a live one wins. */
function registryRow(registry: ClaudeRegistry, alive: (pid: number) => boolean, sessionId: string): { root: string; row: InboxBinding; live: boolean } | undefined {
  let first: { root: string; row: InboxBinding; live: boolean } | undefined;
  for (const root of registry.roots()) {
    const row = registry.read(root).get(sessionId);
    if (!row) continue;
    if (alive(row.pid)) return { root, row, live: true };
    first ??= { root, row, live: false };
  }
  return first;
}

/** A Claude binding the store recorded as detached: its session left its attachment (a /clear, a fork, or a resume elsewhere). */
export function isDetachedClaudeBinding(binding: SessionBinding): boolean {
  return binding.native.harness === HARNESS && isDetachedAttachment(binding);
}

export function claudeReadiness(
  exists: (path: string) => boolean = existsSync,
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
): Readiness {
  if (which("claude") !== null || exists(join(home(), ".local", "bin", "claude"))) return { ready: true };
  return { ready: false, reason: "Claude Code is not installed: there is no claude on PATH or in ~/.local/bin" };
}

/**
 * Both modes launch and resume. Claude Code takes its first work on its launch
 * line, so a launch that has work to follow binds rt's minted session id and
 * starts nothing; the process starts when that work is submitted.
 *
 * Only an interactive session takes peer input: its inbox starts a turn when
 * idle and reads between tool calls when working. A headless run is launched
 * without inbound acceptance, so it advertises neither.
 */
export function claudeSupported(mode: Mode): Array<"launch" | "resume" | "observe" | "peer-idle" | "peer-working"> {
  return mode === "herdr" ? ["launch", "resume", "observe", "peer-idle", "peer-working"] : ["launch", "resume", "observe"];
}

const NOT_SUBMITTABLE = "Claude Code takes its first work on its launch line; rt cannot yet submit work to a running Claude session";

const HERDR_EXECUTION: Partial<Record<AgentEntry["status"], Observation["execution"]>> = {
  working: "working", blocked: "blocked", idle: "idle", done: "idle",
};
const REGISTRY_EXECUTION: Partial<Record<NonNullable<InboxBinding["status"]>, Observation["execution"]>> = {
  busy: "working", idle: "idle",
};

/** Positive evidence that another session now holds this binding's process or pane. A recorded process outranks a pane, which may have been an inherited hint. */
function movedBy(binding: SessionBinding, agents: AgentEntry[] | null, registry: ClaudeRegistry, alive: (pid: number) => boolean): string | null {
  const { pid, pane } = binding.attachment;
  const value = binding.native.value;
  if (pid !== undefined) {
    if (!alive(pid)) return null;
    const now = registry.sessionForPid(pid);
    return now !== null && now !== value ? "claude-registry" : null;
  }
  if (pane === undefined || !agents) return null;
  const ref = parsePaneRef(pane);
  if (ref.server !== "visible") return null;
  const entry = agents.find((e) => e.pane === ref.paneId);
  return entry && entry.session !== null && entry.session !== value ? "herdr" : null;
}

function herdrEntry(binding: SessionBinding, agents: AgentEntry[] | null): AgentEntry | undefined {
  if (!agents) return undefined;
  const bySession = agents.find((e) => e.session === binding.native.value);
  if (bySession) return bySession;
  const { pid, pane } = binding.attachment;
  if (pid !== undefined || pane === undefined) return undefined;
  const ref = parsePaneRef(pane);
  if (ref.server !== "visible") return undefined;
  const entry = agents.find((e) => e.pane === ref.paneId);
  return entry?.session === null ? entry : undefined;
}

export function createClaudeSessions(overrides: Partial<ClaudeSessionDeps> = {}): SessionAdapter {
  const deps: ClaudeSessionDeps = { ...defaultDeps(), ...overrides };

  /** Today's `rt agent` invocation for this request and host; `prompt` only when the work starts with the process. */
  function invocation(
    request: LaunchRequest, session: AgentInvocation["session"], account: string | undefined, headless: boolean, prompt?: string,
  ): AgentInvocation {
    const { model, effort, extraArgs, yolo } = request.selection.options;
    const host = request.host;
    const settingsPath = host?.gate
      ? writeClaudeGateHookSettings({
        agentId: host.gate.agentId, ...(host.gate.subject !== undefined && { subject: host.gate.subject }),
        ...(extraArgs !== undefined && { extraArgs }), inbound: !headless && host.chat === true,
      }, host.log)
      : undefined;
    return {
      session, headless,
      ...(account !== undefined && { account }),
      ...(model !== undefined && { model }),
      ...(effort !== undefined && { effort }),
      ...(!headless && host?.chat === true && { inboundAccept: true }),
      ...(extraArgs !== undefined && { extraArgs }),
      ...(yolo !== undefined && { yolo }),
      ...(prompt !== undefined && { prompt }),
      ...(!headless && host?.env !== undefined && { env: host.env }),
      ...(!headless && host?.unsetEnv !== undefined && host.unsetEnv.length > 0 && { unsetEnv: host.unsetEnv }),
      ...(settingsPath !== undefined && { settingsPath }),
      ...(request.access.readRoots.length > 0 && { addDirs: request.access.readRoots }),
    };
  }

  async function openPane(request: LaunchRequest, inv: AgentInvocation): Promise<Outcome<Pick<NativeLaunch, "attachment" | "surface">>> {
    let command: string;
    try {
      command = buildPaneCommand(request.cwd, inv);
    } catch (err) {
      return fail("invalid", messageOf(err));
    }
    const opened = await deps.openPane({
      cwd: request.cwd, command, reservationId: request.reservationId, ...(request.host !== undefined && { host: request.host }),
    });
    if (!opened.ok) return opened;
    const trust = await deps.acceptTrust(opened.data, request.cwd, request.host);
    const { pane, socket, tabId, workspaceId } = opened.data;
    const surface = {
      ...(tabId !== undefined && { tabId }), ...(workspaceId !== undefined && { workspaceId }), ...(typeof trust === "string" && { trust }),
    };
    return ok({
      attachment: { mode: "herdr", pane, ...(socket !== undefined && { socket }) },
      ...(Object.keys(surface).length > 0 && { surface }),
    });
  }

  /** A launch with work to follow, and every headless one, binds the id and starts nothing: the process starts with its work. */
  async function prepare(request: LaunchRequest, kind: PreparedLaunch["kind"], native: NativeSessionRef, account: string | undefined): Promise<Outcome<NativeLaunch>> {
    if (request.selection.harness !== HARNESS) return fail("invalid", `a ${request.selection.harness} selection cannot start Claude Code`);
    if (request.mode === "headless" || request.prompt !== undefined) return ok({ native, attachment: { mode: request.mode } });
    const session: AgentInvocation["session"] = kind === "launch" ? { kind: "start", sessionId: native.value } : { kind: "resume", sessionId: native.value };
    const opened = await openPane(request, invocation(request, session, account, false));
    return opened.ok ? ok({ native, ...opened.data }) : opened;
  }

  return {
    async launch(request) {
      const account = request.selection.options.account;
      const hint = request.nativeHint;
      const sessionId = hint !== undefined && isValidSessionUuid(hint) ? hint : deps.mintId();
      return prepare(request, "launch", claudeRef(account ?? LEGACY_DEFAULT_PROFILE, sessionId), account);
    },

    async resume(native, request) {
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "Claude Code resumes only its own session ids");
      // Claude transcripts are per account, so a session resumes under the one that created it.
      const account = native.profile === LEGACY_DEFAULT_PROFILE ? undefined : native.profile;
      const asked = request.selection.options.account;
      if (asked !== undefined && asked !== account) {
        return fail("invalid", `this session belongs to ${native.profile}, and a Claude session resumes only under its own account`);
      }
      return prepare(request, "resume", native, account);
    },

    async discover() {
      const accounts = memo(deps.cswapAccounts);
      const found: NativeLaunch[] = [];
      const seen = new Set<string>();
      for (const root of deps.registry.roots()) {
        const profile = await profileForConfigDir(dirname(root), accounts);
        if (profile === undefined) continue;
        for (const [sessionId, row] of deps.registry.read(root)) {
          const key = `${profile}\0${sessionId}`;
          if (seen.has(key) || !deps.processAlive(row.pid)) continue;
          seen.add(key);
          found.push({ native: claudeRef(profile, sessionId), attachment: { mode: "herdr", pid: row.pid } });
        }
      }
      return found;
    },

    async observe(binding, sweep) {
      const { native, attachment } = binding;
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "only a Claude Code session id is observed here");
      const at = deps.now();
      // Background stays unknown and execution is never dead: screen and process parsing still live in the herd watchdog.
      const seen = (o: Pick<Observation, "connectivity" | "execution" | "source">, generation = attachment.generation): Outcome<Observation> =>
        ok({ ...o, background: "unknown", observedAt: at, generation });
      if (isDetachedClaudeBinding(binding)) return seen({ connectivity: "unknown", execution: "unknown", source: "store" });

      const registry = sweep ? sweep.memo("claude:registry", () => snapshotRegistry(deps.registry)) : deps.registry;
      const agents = await (sweep ? sweep.memo("claude:agents", () => deps.agents()) : deps.agents());
      const moved = movedBy(binding, agents, registry, deps.processAlive);
      if (moved) {
        const detached = (await deps.store()).detach(binding.key, attachment.generation);
        if (!detached.ok) return detached;
        return seen({ connectivity: "disconnected", execution: "unknown", source: moved }, detached.data.attachment.generation);
      }

      const found = registryRow(registry, deps.processAlive, native.value);
      // A disconnected inbox is a transport fact: it never makes the session dead.
      const connectivity: Observation["connectivity"] = !found ? "unknown"
        : found.live && deps.socketExists(found.row.socketPath) ? "connected" : "disconnected";
      const fromHerdr = herdrEntry(binding, agents);
      if (fromHerdr) return seen({ connectivity, execution: HERDR_EXECUTION[fromHerdr.status] ?? "unknown", source: "herdr" });
      if (found) {
        const execution = found.live && found.row.status ? REGISTRY_EXECUTION[found.row.status] ?? "unknown" : "unknown";
        return seen({ connectivity, execution, source: "claude-registry" });
      }
      return seen({ connectivity, execution: "unknown", source: "none" });
    },

    /** Starts the process a prepared launch deferred, with the work on its launch line (herdr) or its stdin (headless). */
    async startWork(binding, input, prepared): Promise<Outcome<WorkReceipt>> {
      const { native, attachment } = binding;
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "only a Claude Code session id takes work here");
      if (!prepared || prepared.request.selection.harness !== HARNESS) return fail("unsupported", NOT_SUBMITTABLE);
      if (attachment.pane !== undefined || attachment.pid !== undefined) return fail("unsupported", NOT_SUBMITTABLE);
      const { request } = prepared;
      const account = native.profile === LEGACY_DEFAULT_PROFILE ? undefined : native.profile;
      const session: AgentInvocation["session"] = prepared.kind === "launch"
        ? { kind: "start", sessionId: native.value } : { kind: "resume", sessionId: native.value };
      const receipt = { id: input.id, evidence: "submitted" as const, nativeId: native.value };

      if (request.mode === "herdr") {
        const opened = await openPane(request, invocation(request, session, account, false, input.text));
        return opened.ok ? ok({ ...receipt, ...opened.data }) : opened;
      }

      let argv: string[];
      try {
        argv = buildClaudeArgv(invocation(request, session, account, true, input.text));
      } catch (err) {
        return fail("invalid", messageOf(err));
      }
      const unset = request.host?.unsetEnv;
      let child: ReturnType<RunWorkProcess>;
      try {
        child = (request.host?.runProcess ?? deps.spawn)(argv, request.cwd, request.host?.env ?? {}, {
          stdin: input.text, ...(unset !== undefined && unset.length > 0 && { unset }),
        });
      } catch (err) {
        // A spawn that throws never started a process, so nothing was sent.
        return fail("not-ready", `Claude Code could not start: ${messageOf(err)}`);
      }
      const log = request.host?.log;
      const completion = child.exited.then(async (exitCode) => {
        try {
          return { exitCode, body: await child.stdout() };
        } catch (err) {
          log?.warn({ err, session: native.value }, "agent: headless Claude output could not be read; its exit code still finishes the run");
          return { exitCode, body: "" };
        }
      });
      return ok({
        ...receipt, attachment: { mode: "headless", ...(child.pid !== undefined && { pid: child.pid }) }, completion,
      });
    },

    /** A running process on the session is the evidence; a resume's older process counts too, since starting another would be the duplicate. */
    async reconcileWork(binding, probe, sweep) {
      const { native } = binding;
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "only a Claude Code session id is reconciled here");
      const registry = sweep ? sweep.memo("claude:registry", () => snapshotRegistry(deps.registry)) : deps.registry;
      const found = registryRow(registry, deps.processAlive, native.value);
      const agents = found?.live === true ? null : await (sweep ? sweep.memo("claude:agents", () => deps.agents()) : deps.agents());
      const running = found?.live === true || agents?.some((entry) => entry.session === native.value) === true;
      return ok(running ? { id: probe.id, evidence: "submitted", nativeId: native.value } : null);
    },
  };
}

export type SignInClaim = { sessionId: string; explicit: boolean };
export type SignInDeps = Partial<Pick<ClaudeSessionDeps, "registry" | "processAlive" | "cswapAccounts">> & { db?: Database };
/** Commits once the daemon names the identity: the binding, null for a sign-in that stays unbound, or a refusal. */
export type SignInCommit = (identity: string) => Outcome<SessionBinding | null>;

/**
 * Sign-in is a trusted binding point: the session's own environment carries
 * its id. An explicit id, and a binding observed detached, bind only while
 * Claude Code's registry shows that session live, since the id a /clear
 * leaves behind in an older process looks like any other. When no binding
 * can be prepared the session signs in unbound, as it always has; only a
 * binding of this session held by another identity refuses.
 */
export async function prepareClaudeSignIn(
  claim: SignInClaim, env: NodeJS.ProcessEnv, overrides: SignInDeps = {},
): Promise<SignInCommit> {
  const { sessionId } = claim;
  const registry = overrides.registry ?? defaultRegistry;
  const accounts = memo(overrides.cswapAccounts ?? defaultCswapAccounts);
  const db = overrides.db ?? (await import("../../state/db.ts")).getStateDb();
  try {
    (await import("../legacy.ts")).migrateLegacySessions(db);
  } catch (err) {
    // A busy migration is retried by the next resolve; this sign-in reads what is recorded now.
    if (!isBusyError(err)) throw err;
  }

  const found = registryRow(registry, overrides.processAlive ?? isAlive, sessionId);
  const live = found?.live ? found : undefined;
  const attachment: AttachmentInput = {
    mode: "herdr", ...(text(env.HERDR_PANE_ID) && { pane: env.HERDR_PANE_ID }), ...(live && { pid: live.row.pid }),
  };
  const store = createSessionStore(db);
  const recorded = listBindingsByNativeValue(db, sessionId).filter((b) => b.native.harness === HARNESS && b.native.kind === "id");
  const refused = fail<SessionBinding | null>("refused", `Claude Code session ${sessionId} already belongs to another identity`);
  const held = (identity: string) => recorded.some((b) => b.identity !== identity);
  const unbound: SignInCommit = (identity) => (held(identity) ? refused : ok(null));

  if ((claim.explicit && !live) || recorded.length > 1) return unbound;
  const current = recorded[0];
  if (current && !isDetachedClaudeBinding(current)) return (identity) => (held(identity) ? refused : ok(current));
  if (current) {
    if (!live) return unbound;
    return (identity) => (held(identity) ? refused : store.replaceAttachment(current.key, current.attachment.generation, attachment));
  }

  const profile = await profileForConfigDir(live ? dirname(live.root) : env.CLAUDE_CONFIG_DIR, accounts);
  if (profile === undefined) return unbound;
  const native = claudeRef(profile, sessionId);
  return (identity) => store.bind(store.reserve({ identity }), native, attachment);
}
