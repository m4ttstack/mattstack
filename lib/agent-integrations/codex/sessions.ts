/**
 * Codex's session integration: threads created and resumed on the running
 * Codex app server through Mattstack's own control connection, a Herdr
 * terminal attached to them by explicit remote resume, and observations from
 * that connection's native events.
 *
 * Codex mints the thread id, so a launch knows its native reference only from
 * the thread/start reply. The thread is created with its permissions, then
 * takes one harmless initialization turn (a fresh thread has no rollout to
 * resume until a turn is persisted), and only then does a terminal attach.
 * Headless mode is the same owned thread with no terminal. A start whose
 * reply never came stays an unresolved reservation that a later launch with
 * the same reservation id reconciles; nothing here starts a second thread to
 * cover an unknown result.
 *
 * This adapter never assigns a herd job and never writes the session store.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join, resolve } from "path";
import type {
  FaultCode, Mode, NativeSessionRef, Outcome, Readiness, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { buildCodexRemoteResumeCommand } from "../../agent-argv/codex.ts";
import type { LaunchRequest, NativeLaunch, SessionAdapter } from "../contracts.ts";
import {
  CodexControlError, connectCodexControl, discoverCodexEndpoint,
  type CodexClock, type CodexControl, type CodexControlLog, type CodexControlOptions, type CodexEndpoint, type LaunchReservation,
} from "./control.ts";
import { codexEventHub } from "./events.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { CODEX_STATUS_ENUMS, isRecord, type CodexThreadStatus } from "./protocol.ts";

const HARNESS = "codex";

/** The initialization turn's whole input; the attached terminal shows it as the thread's history. */
export const CODEX_INIT_PROMPT = "Reply READY and nothing else.";

/** What the native reply reported about the thread's working directory and policy. */
export type CodexThreadSettings = {
  cwd?: string; runtimeWorkspaceRoots?: string[]; sandbox?: unknown; approvalPolicy?: unknown;
};
export type CodexLaunch = NativeLaunch & { settings: CodexThreadSettings };
export interface CodexSessionAdapter extends SessionAdapter {
  launch(request: LaunchRequest): Promise<Outcome<CodexLaunch>>;
  resume(ref: NativeSessionRef, request: LaunchRequest): Promise<Outcome<CodexLaunch>>;
}

export type PaneLaunch = { cwd: string; command: string; reservationId: string };
export type PaneOpened = { pane: string; socket?: string };

export type CodexSessionDeps = {
  now(): number;
  clock: CodexClock;
  initTurnTimeoutMs: number;
  /** Where the app server listens; a terminal attaches there. Without it only headless sessions run. */
  endpoint?: CodexEndpoint;
  openPane(launch: PaneLaunch): Promise<Outcome<PaneOpened>>;
  /** Positive evidence that the terminal shows the thread; a folder-trust prompt is not. */
  confirmAttached(opened: PaneOpened, expected: { threadId: string; history: string }): Promise<Outcome<void>>;
  unresolved: Map<string, UnresolvedLaunch>;
};

const ATTACH_READS = 30;
const ATTACH_READ_MS = 500;

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): FaultCode => (err instanceof CodexControlError ? err.code : "transient");
const failFrom = <T>(err: unknown, prefix = ""): Outcome<T> => fail(codeOf(err), `${prefix}${messageOf(err)}`);
const home = (): string => process.env.HOME ?? homedir();

/** Reads the pane until the thread's own history shows, collapsing the terminal's wrapping. */
export async function awaitCodexHistory(
  read: () => Promise<string | null>, history: string, opts: { attempts: number; sleep(): Promise<void> },
): Promise<Outcome<void>> {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const wanted = flat(history);
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    if (attempt > 0) await opts.sleep();
    const screen = await read();
    if (screen !== null && flat(screen).includes(wanted)) return ok(undefined);
  }
  return fail("not-ready", "the terminal never showed the thread's history; a folder-trust prompt or a failed start is holding it");
}

function defaultDeps(): CodexSessionDeps {
  return {
    now: Date.now,
    clock: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as Timer) },
    initTurnTimeoutMs: 180_000,
    unresolved: UNRESOLVED,
    openPane: async ({ cwd, command, reservationId }) => {
      const { launchInWorkspace } = await import("../../agent-herdr.ts");
      try {
        const out = await launchInWorkspace({ workspaceLabel: basename(cwd), tabLabel: reservationId, paneCommand: command });
        return out.focusedExisting ? fail("refused", `tab "${reservationId}" already open; focused it`) : ok({ pane: out.paneId });
      } catch (err) {
        return fail("transient", messageOf(err));
      }
    },
    confirmAttached: async (opened, expected) => {
      const [{ herdrRequest }, { parsePaneRef }] = await Promise.all([
        import("../../herdr/client.ts"), import("../../../packages/rt-client/src/pane-ref.ts"),
      ]);
      const pane = parsePaneRef(opened.pane).paneId;
      const read = async () => {
        const screen = await herdrRequest<{ read?: { text?: unknown } }>(
          "pane.read", { pane_id: pane, source: "visible" }, opened.socket ? { sockPath: opened.socket } : {},
        );
        return screen.ok && typeof screen.result.read?.text === "string" ? screen.result.read.text : null;
      };
      return awaitCodexHistory(read, expected.history, {
        attempts: ATTACH_READS, sleep: () => new Promise((r) => setTimeout(r, ATTACH_READ_MS)),
      });
    },
  };
}

/** Why the shared loader's last connection attempt failed; cleared when one succeeds. */
let appServerFailure: string | undefined;

/** An installed binary, and no failed connection to its app server; readiness never starts or probes that server. */
export function codexReadiness(
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
  exists: (path: string) => boolean = existsSync,
  connectionFailure: string | undefined = appServerFailure,
): Readiness {
  if (which("codex") === null && !exists(join(home(), ".local", "bin", "codex"))) {
    return { ready: false, reason: "Codex is not installed: there is no codex on PATH or in ~/.local/bin" };
  }
  if (connectionFailure !== undefined) return { ready: false, reason: `rt cannot reach the Codex app server: ${connectionFailure}` };
  return { ready: true };
}

/** Both modes run on an owned app-server thread, so both launch, resume and observe. */
export function codexSupported(_mode: Mode): Array<"launch" | "resume" | "observe"> {
  return ["launch", "resume", "observe"];
}

function threadOf(result: unknown): Record<string, unknown> | undefined {
  return isRecord(result) && isRecord(result.thread) ? result.thread : undefined;
}

function settingsOf(result: unknown): CodexThreadSettings {
  if (!isRecord(result)) return {};
  const roots = result.runtimeWorkspaceRoots;
  return {
    ...(typeof result.cwd === "string" && { cwd: result.cwd }),
    ...(Array.isArray(roots) && roots.every((r) => typeof r === "string") && { runtimeWorkspaceRoots: roots as string[] }),
    ...(result.sandbox !== undefined && { sandbox: result.sandbox }),
    ...(result.approvalPolicy !== undefined && { approvalPolicy: result.approvalPolicy }),
  };
}

function threadStatus(value: unknown): CodexThreadStatus | undefined {
  if (!isRecord(value) || !(CODEX_STATUS_ENUMS.thread as readonly unknown[]).includes(value.type)) return undefined;
  if (value.type !== "active") return { type: value.type as Exclude<CodexThreadStatus["type"], "active"> };
  const flags = Array.isArray(value.activeFlags) ? value.activeFlags : [];
  return { type: "active", activeFlags: flags.filter((f) => (CODEX_STATUS_ENUMS.activeFlag as readonly unknown[]).includes(f)) };
}

/** Selected options become thread/start fields; a CLI-only option has no thread form and is refused. */
function startParams(cwd: string, options: LaunchRequest["selection"]["options"]): Outcome<Record<string, unknown>> {
  if (options.account !== undefined) return fail("unsupported", "codex does not support --account in this version (see spec's Non-goals)");
  if (text(options.extraArgs)) {
    return fail("unsupported", "extra codex command-line arguments cannot be applied to a thread rt creates on the app server");
  }
  return ok({
    cwd,
    ...(text(options.model) && { model: options.model }),
    ...(text(options.effort) && { config: { model_reasoning_effort: options.effort } }),
    ...(options.yolo === true && { approvalPolicy: "never", sandbox: "danger-full-access" }),
  });
}

export type UnresolvedLaunch = { profile: string; reservation: LaunchReservation };

/**
 * Launches whose thread/start answer never came, keyed by profile and
 * reservation id. They outlive the connection: a thread may exist even when
 * the connection that asked for it closed before the reply could arrive.
 */
const UNRESOLVED = new Map<string, UnresolvedLaunch>();

export function createCodexSessions(control: CodexControl, overrides: Partial<CodexSessionDeps> = {}): CodexSessionAdapter {
  const deps: CodexSessionDeps = { ...defaultDeps(), ...overrides };
  const hub = codexEventHub(control);
  const unresolved = deps.unresolved;
  const ref = (value: string): NativeSessionRef => ({ harness: HARNESS, profile: control.profile, kind: "id", value });

  function checkRequest(request: LaunchRequest): Outcome<string> {
    if (request.selection.harness !== HARNESS) return fail("invalid", `a ${request.selection.harness} selection cannot start Codex`);
    if (!isAbsolute(request.cwd)) return fail("invalid", "a Codex session needs an absolute working directory");
    if (request.mode === "herdr" && !deps.endpoint) {
      return fail("not-ready", "the Codex app server's endpoint is unknown, so no terminal can attach to a thread");
    }
    return ok(resolve(request.cwd));
  }

  function checkRef(native: NativeSessionRef): Outcome<void> {
    if (native.harness !== HARNESS || native.kind !== "id" || !text(native.value)) {
      return fail("invalid", "only a Codex thread id is handled here");
    }
    if (native.profile !== control.profile) {
      return fail("invalid", `thread ${native.value} belongs to Codex profile ${native.profile}, and this connection serves ${control.profile}`);
    }
    return ok(undefined);
  }

  async function attach(cwd: string, threadId: string, history: string, reservationId: string): Promise<Outcome<NativeLaunch["attachment"]>> {
    let command: string;
    try {
      command = buildCodexRemoteResumeCommand(cwd, { socketPath: deps.endpoint!.socketPath, threadId });
    } catch (err) {
      return fail("invalid", messageOf(err));
    }
    const opened = await deps.openPane({ cwd, command, reservationId });
    if (!opened.ok) return opened;
    const shown = await deps.confirmAttached(opened.data, { threadId, history });
    if (!shown.ok) {
      return fail("not-ready", `Codex opened in pane ${opened.data.pane} but has not attached to thread ${threadId}: ${shown.error.message}`);
    }
    const { pane, socket } = opened.data;
    return ok({ mode: "herdr", pane, ...(socket !== undefined && { socket }) });
  }

  /** Everything after the thread exists: the initialization turn, then the terminal. */
  async function finish(request: LaunchRequest, cwd: string, threadId: string, result: unknown): Promise<Outcome<CodexLaunch>> {
    control.adopt(threadId);
    const created = `Codex created thread ${threadId}, but `;
    let turnId: unknown;
    try {
      const started = await control.request("turn/start", { threadId, input: [{ type: "text", text: CODEX_INIT_PROMPT }] });
      turnId = isRecord(started) && isRecord(started.turn) ? started.turn.id : undefined;
    } catch (err) {
      return failFrom(err, `${created}its initialization turn did not start: `);
    }
    if (!text(turnId)) return fail("invalid", `${created}its initialization turn came back without an id`);
    const ended = await hub.waitTurn(threadId, turnId, deps.clock, deps.initTurnTimeoutMs);
    if (ended === undefined) return fail("transient", `${created}its initialization turn did not finish in time`);
    if (ended !== "completed") return fail("not-ready", `${created}its initialization turn ended ${ended}, so it cannot be resumed`);

    const settings = settingsOf(result);
    if (request.mode === "headless") return ok({ native: ref(threadId), attachment: { mode: "headless" }, settings });
    const attachment = await attach(cwd, threadId, CODEX_INIT_PROMPT, request.reservationId);
    return attachment.ok ? ok({ native: ref(threadId), attachment: attachment.data, settings }) : attachment;
  }

  return {
    async launch(request) {
      const checked = checkRequest(request);
      if (!checked.ok) return checked;
      const cwd = checked.data;
      const params = startParams(cwd, request.selection.options);
      if (!params.ok) return params;

      const key = `${control.profile}\0${request.reservationId}`;
      let reservation = unresolved.get(key)?.reservation;
      if (reservation) {
        if (reservation.cwd !== cwd) return fail("invalid", `reservation ${request.reservationId} is held for ${reservation.cwd}, not ${cwd}`);
        if (reservation.state === "unknown") {
          return fail("ambiguous", `Codex has not said whether reservation ${request.reservationId} created a thread; rt will not start a second one`);
        }
        unresolved.delete(key);
        if (reservation.state !== "started") {
          reservation.release();
          reservation = undefined;
        }
      }

      let result: unknown = reservation?.result;
      if (!reservation) {
        for (const held of unresolved.values()) {
          if (held.profile === control.profile && held.reservation.cwd === cwd) {
            return fail("refused", `an earlier Codex launch in ${cwd} has not been reconciled, so rt will not start another thread there`);
          }
        }
        const reserved = control.reserveLaunch(cwd);
        if (!reserved.ok) return reserved;
        reservation = reserved.data;
        try {
          result = await control.request("thread/start", params.data);
        } catch (err) {
          if (reservation.state === "unknown") {
            unresolved.set(key, { profile: control.profile, reservation });
            return fail("ambiguous", `Codex did not answer thread/start for ${cwd}; the launch stays reserved until it is reconciled (${messageOf(err)})`);
          }
          reservation.release();
          return failFrom(err);
        }
      }
      try {
        return await finish(request, cwd, reservation.threadId!, result);
      } finally {
        reservation.release();
      }
    },

    async resume(native, request) {
      const valid = checkRef(native);
      if (!valid.ok) return valid;
      const checked = checkRequest(request);
      if (!checked.ok) return checked;
      const cwd = checked.data;
      const threadId = native.value;
      control.adopt(threadId);

      let read: unknown;
      try {
        read = await control.request("thread/read", { threadId, includeTurns: false });
      } catch (err) {
        return failFrom(err, `Codex could not read thread ${threadId}: `);
      }
      const thread = threadOf(read);
      if (thread?.id !== threadId) return fail("ambiguous", `Codex answered for a different thread than ${threadId}`);
      if (typeof thread.cwd === "string" && resolve(thread.cwd) !== cwd) {
        return fail("invalid", `thread ${threadId} works in ${thread.cwd}, so it resumes there, not in ${cwd}`);
      }
      const settings: CodexThreadSettings = typeof thread.cwd === "string" ? { cwd: thread.cwd } : {};

      if (request.mode === "headless") {
        let resumed: unknown;
        try {
          resumed = await control.request("thread/resume", { threadId, excludeTurns: true });
        } catch (err) {
          return failFrom(err, `Codex could not resume thread ${threadId}: `);
        }
        const now = threadOf(resumed);
        if (now?.id !== threadId) {
          return fail("ambiguous", `Codex resumed ${String(now?.id)} instead of thread ${threadId}; rt will not continue a different conversation`);
        }
        return ok({ native, attachment: { mode: "headless" }, settings: settingsOf(resumed) });
      }

      if (!text(thread.preview)) return fail("not-ready", `thread ${threadId} has no history yet, so a terminal cannot resume it`);
      const attachment = await attach(cwd, threadId, thread.preview, request.reservationId);
      return attachment.ok ? ok({ native, attachment: attachment.data, settings }) : attachment;
    },

    // Codex's loaded-thread list says nothing about a thread's terminal or owner; a manual session names itself by CODEX_THREAD_ID.
    async discover() {
      return [];
    },

    async observe(binding: SessionBinding) {
      const valid = checkRef(binding.native);
      if (!valid.ok) return valid;
      if (control.closed) return fail("transient", "the Codex control connection is closed");
      const threadId = binding.native.value;
      control.adopt(threadId);
      if (!hub.view(threadId)) {
        try {
          const status = threadStatus(threadOf(await control.request("thread/read", { threadId, includeTurns: false }))?.status);
          if (status) hub.seed(threadId, status);
        } catch {
          // An unreadable thread is a missing channel: the observation stays unknown.
        }
      }
      const view = hub.view(threadId) ?? { connectivity: "unknown", execution: "unknown", source: "none" };
      return ok({
        connectivity: view.connectivity, execution: view.execution, background: "unknown",
        observedAt: deps.now(), source: view.source, generation: binding.attachment.generation,
      });
    },

    async startWork() {
      return fail("unsupported", "work reaches a Codex thread through the shared launcher's submission step, which this adapter does not provide yet");
    },
  };
}

/** Stands in when no connection could be made, so each operation reports why. */
function unavailableSessions(error: { code: FaultCode; message: string }): SessionAdapter {
  const refused = async () => ({ ok: false as const, error });
  return { launch: refused, resume: refused, observe: refused, startWork: refused, discover: async () => [] };
}

export type CodexSessionLoaderDeps = {
  env: NodeJS.ProcessEnv;
  discover(): Promise<Outcome<CodexEndpoint>>;
  connect(options: CodexControlOptions): Promise<CodexControl>;
  sessions: Partial<CodexSessionDeps>;
  /** Each connection attempt's outcome: the failure, or null once connected. */
  onConnection(failure: { code: FaultCode; message: string } | null): void;
};

const controlLog: CodexControlLog = (level, message, fields) => {
  if (level !== "warn") return;
  void import("../../ui/warn.ts").then(({ warn }) => warn("codex-control", message, { context: fields }));
};

/** One live connection per loader; a closed one is replaced on the next load. */
export function createCodexSessionLoader(overrides: Partial<CodexSessionLoaderDeps> = {}): () => Promise<SessionAdapter> {
  const deps: CodexSessionLoaderDeps = {
    env: process.env,
    discover: () => discoverCodexEndpoint(),
    connect: (options) => connectCodexControl(options, { log: controlLog }),
    sessions: {},
    onConnection: () => {},
    ...overrides,
  };
  let current: { control: CodexControl; adapter: SessionAdapter } | undefined;
  let opening: Promise<SessionAdapter> | undefined;

  function unavailable(error: { code: FaultCode; message: string }): SessionAdapter {
    deps.onConnection(error);
    return unavailableSessions(error);
  }

  async function open(): Promise<SessionAdapter> {
    const endpoint = await deps.discover();
    if (!endpoint.ok) return unavailable(endpoint.error);
    let control: CodexControl;
    try {
      control = await deps.connect({ socketPath: endpoint.data.socketPath, profile: canonicalCodexProfile(undefined, deps.env) });
    } catch (err) {
      return unavailable({ code: codeOf(err), message: messageOf(err) });
    }
    deps.onConnection(null);
    const adapter = createCodexSessions(control, { ...deps.sessions, endpoint: endpoint.data });
    current = { control, adapter };
    return adapter;
  }

  return () => {
    if (current && !current.control.closed) return Promise.resolve(current.adapter);
    return (opening ??= open().finally(() => {
      opening = undefined;
    }));
  };
}

let shared: (() => Promise<SessionAdapter>) | undefined;

export function loadCodexSessions(): Promise<SessionAdapter> {
  shared ??= createCodexSessionLoader({ onConnection: (failure) => { appServerFailure = failure?.message; } });
  return shared();
}
