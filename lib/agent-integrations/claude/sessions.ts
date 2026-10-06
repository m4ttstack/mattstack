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
import type { AgentInvocation } from "../../agent-argv/types.ts";
import { registryRoots, resolveAllInboxes, sessionForPid, type InboxBinding } from "../../claude-registry.ts";
import type { AgentEntry } from "../../runs/liveness.ts";
import { isBusyError } from "../../state/busy.ts";
import type { LaunchRequest, NativeLaunch, SessionAdapter } from "../contracts.ts";
import {
  createSessionStore, LEGACY_DEFAULT_PROFILE, listBindingsByNativeValue, type AttachmentInput, type SessionStore,
} from "../session-store.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function shellSingleQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export type ClaudeInvocation = AgentInvocation;

/** The inline `--settings` JSON `inboundAccept` triggers on its own (no settingsPath). Exported so a settingsPath caller can merge it into the SAME file instead of the flag being emitted twice. */
export const CROSS_SESSION_INBOUND_SETTINGS = { crossSessionInbound: "accept" } as const;

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
  return `cd ${shellSingleQuote(cwd)} && ${[...env, head, ...quoted].join(" ")}`;
}

export type PaneLaunch = { cwd: string; command: string; reservationId: string };
export type PaneOpened = { pane: string; socket?: string };

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
  acceptTrust(opened: PaneOpened, cwd: string): Promise<unknown>;
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

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
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
    openPane: async ({ cwd, command, reservationId }) => {
      const { launchInWorkspace } = await import("../../agent-herdr.ts");
      try {
        const out = await launchInWorkspace({ workspaceLabel: basename(cwd), tabLabel: reservationId, paneCommand: command });
        return out.focusedExisting ? fail("refused", `tab "${reservationId}" already open; focused it`) : ok({ pane: out.paneId });
      } catch (err) {
        return fail("transient", messageOf(err));
      }
    },
    acceptTrust: async (opened, cwd) => {
      const [{ acceptTrustOnPane, cwdPath }, { herdrRequest }] = await Promise.all([
        import("../../daemon/trust-accept.ts"), import("../../herdr/client.ts"),
      ]);
      return acceptTrustOnPane({
        herdr: herdrRequest, sock: opened.socket ? { sockPath: opened.socket } : {},
        pane: parsePaneRef(opened.pane).paneId, context: { cwd }, trustsPath: cwdPath(cwd), waitBudgetMs: TRUST_PAINT_MS,
      });
    },
    agents: async () => (await import("../../runs/liveness.ts")).recentAgents(),
    registry: defaultRegistry,
    processAlive,
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

/** Generation 1 is whatever the bind recorded; a later replacement that leaves no pane, socket or process attached is an observed detachment. */
export function isDetachedClaudeBinding(binding: SessionBinding): boolean {
  const a = binding.attachment;
  return binding.native.harness === HARNESS && a.generation > 1
    && a.pane === undefined && a.socket === undefined && a.pid === undefined;
}

export function claudeReadiness(
  exists: (path: string) => boolean = existsSync,
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
): Readiness {
  if (which("claude") !== null || exists(join(home(), ".local", "bin", "claude"))) return { ready: true };
  return { ready: false, reason: "Claude Code is not installed: there is no claude on PATH or in ~/.local/bin" };
}

/** Headless Claude runs one prompt per process, so it cannot launch without submitting its work. */
export function claudeSupported(mode: Mode): Array<"launch" | "resume" | "observe"> {
  return mode === "herdr" ? ["launch", "resume", "observe"] : ["observe"];
}

const HEADLESS_UNSUPPORTED = "headless Claude Code takes its prompt when it starts, so it cannot launch or resume ahead of its work";

const HERDR_EXECUTION: Partial<Record<AgentEntry["status"], Observation["execution"]>> = {
  working: "working", blocked: "blocked", idle: "idle", done: "idle",
};
const REGISTRY_EXECUTION: Partial<Record<NonNullable<InboxBinding["status"]>, Observation["execution"]>> = {
  busy: "working", idle: "idle",
};

/** Positive evidence that another session now holds this binding's process or pane. A recorded process outranks a pane, which may have been an inherited hint. */
function movedBy(binding: SessionBinding, agents: AgentEntry[] | null, registry: ClaudeRegistry): string | null {
  const { pid, pane } = binding.attachment;
  const value = binding.native.value;
  if (pid !== undefined) {
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

  async function open(
    request: LaunchRequest, session: AgentInvocation["session"], account: string | undefined, native: NativeSessionRef,
  ): Promise<Outcome<NativeLaunch>> {
    if (request.mode !== "herdr") return fail("unsupported", HEADLESS_UNSUPPORTED);
    if (request.selection.harness !== HARNESS) return fail("invalid", `a ${request.selection.harness} selection cannot start Claude Code`);
    const { model, effort, extraArgs, yolo } = request.selection.options;
    const inv: AgentInvocation = {
      session, headless: false,
      ...(account !== undefined && { account }),
      ...(model !== undefined && { model }),
      ...(effort !== undefined && { effort }),
      ...(extraArgs !== undefined && { extraArgs }),
      ...(yolo !== undefined && { yolo }),
      ...(request.access.readRoots.length > 0 && { addDirs: request.access.readRoots }),
    };
    let command: string;
    try {
      command = buildPaneCommand(request.cwd, inv);
    } catch (err) {
      return fail("invalid", messageOf(err));
    }
    const opened = await deps.openPane({ cwd: request.cwd, command, reservationId: request.reservationId });
    if (!opened.ok) return opened;
    await deps.acceptTrust(opened.data, request.cwd);
    const { pane, socket } = opened.data;
    return ok({ native, attachment: { mode: "herdr", pane, ...(socket !== undefined && { socket }) } });
  }

  return {
    async launch(request) {
      const account = request.selection.options.account;
      const sessionId = deps.mintId();
      return open(request, { kind: "start", sessionId }, account, claudeRef(account ?? LEGACY_DEFAULT_PROFILE, sessionId));
    },

    async resume(native, request) {
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "Claude Code resumes only its own session ids");
      // Claude transcripts are per account, so a session resumes under the one that created it.
      const account = native.profile === LEGACY_DEFAULT_PROFILE ? undefined : native.profile;
      const asked = request.selection.options.account;
      if (asked !== undefined && asked !== account) {
        return fail("invalid", `this session belongs to ${native.profile}, and a Claude session resumes only under its own account`);
      }
      return open(request, { kind: "resume", sessionId: native.value }, account, native);
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

    async observe(binding) {
      const { native, attachment } = binding;
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "only a Claude Code session id is observed here");
      const at = deps.now();
      const seen = (o: Pick<Observation, "connectivity" | "execution" | "source">, generation = attachment.generation): Outcome<Observation> =>
        ok({ ...o, background: "unknown", observedAt: at, generation });
      if (isDetachedClaudeBinding(binding)) return seen({ connectivity: "unknown", execution: "unknown", source: "store" });

      const agents = await deps.agents();
      const moved = movedBy(binding, agents, deps.registry);
      if (moved) {
        const detached = (await deps.store()).replaceAttachment(binding.key, attachment.generation, { mode: attachment.mode });
        if (!detached.ok) return detached;
        return seen({ connectivity: "disconnected", execution: "unknown", source: moved }, detached.data.attachment.generation);
      }

      const found = registryRow(deps.registry, deps.processAlive, native.value);
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

    async startWork() {
      return fail("unsupported", "Claude Code takes its first work on its launch line; rt cannot yet submit work to a running Claude session");
    },
  };
}

export type SignInClaim = { sessionId: string; explicit: boolean };
export type SignInDeps = Partial<Pick<ClaudeSessionDeps, "registry" | "processAlive" | "cswapAccounts">> & { db?: Database };

/**
 * Sign-in is a trusted binding point: the session's own environment carries
 * its id. An explicit id, and a binding observed detached, bind only while
 * Claude Code's registry shows that session live, since the id a /clear
 * leaves behind in an older process looks like any other. The identity is
 * the one the daemon signs the session in as, so binding commits after it.
 */
export async function prepareClaudeSignIn(
  claim: SignInClaim, env: NodeJS.ProcessEnv, overrides: SignInDeps = {},
): Promise<Outcome<(identity: string) => Outcome<SessionBinding>>> {
  const { sessionId } = claim;
  const registry = overrides.registry ?? defaultRegistry;
  const accounts = memo(overrides.cswapAccounts ?? defaultCswapAccounts);
  const db = overrides.db ?? (await import("../../state/db.ts")).getStateDb();
  try {
    (await import("../legacy.ts")).migrateLegacySessions(db);
  } catch (err) {
    if (isBusyError(err)) return fail("transient", "the state database is busy; try again");
    throw err;
  }

  const found = registryRow(registry, overrides.processAlive ?? processAlive, sessionId);
  const live = found?.live ? found : undefined;
  if (claim.explicit && !live) return fail("ambiguous", `session ${sessionId} is not a live Claude Code session on this machine`);
  const attachment: AttachmentInput = {
    mode: "herdr", ...(text(env.HERDR_PANE_ID) && { pane: env.HERDR_PANE_ID }), ...(live && { pid: live.row.pid }),
  };
  const store = createSessionStore(db);
  const refused = fail<SessionBinding>("refused", `Claude Code session ${sessionId} already belongs to another identity`);

  const recorded = listBindingsByNativeValue(db, sessionId).filter((b) => b.native.harness === HARNESS && b.native.kind === "id");
  if (recorded.length > 1) return fail("ambiguous", `Claude Code session ${sessionId} is recorded under more than one profile`);
  const current = recorded[0];
  if (current && !isDetachedClaudeBinding(current)) {
    return ok((identity) => (identity === current.identity ? ok(current) : refused));
  }
  if (current) {
    if (!live) return fail("stale-binding", `Claude Code session ${sessionId} left its last attachment and is not live on this machine`);
    return ok((identity) => (identity === current.identity
      ? store.replaceAttachment(current.key, current.attachment.generation, attachment)
      : refused));
  }

  const profile = await profileForConfigDir(live ? dirname(live.root) : env.CLAUDE_CONFIG_DIR, accounts);
  if (profile === undefined) return fail("ambiguous", "rt could not tell which Claude account this session runs under");
  const native = claudeRef(profile, sessionId);
  return ok((identity) => store.bind(store.reserve({ identity }), native, attachment));
}
