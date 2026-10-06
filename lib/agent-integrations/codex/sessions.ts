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
 * Headless mode is the same owned thread with no terminal.
 *
 * Every launch or attach that does not finish stays recorded under its
 * reservation id with whatever it already made (the thread, the init turn,
 * the pane). A retry with the same reservation id carries on from there;
 * nothing here starts a second thread or opens a second pane to cover an
 * unfinished or unknown result.
 *
 * Limit: tools run in the user-started app server, whose env rt cannot set, so a worker's gate identity comes from its binding.
 *
 * This adapter never assigns a herd job and never writes the session store.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import type {
  FaultCode, Mode, NativeSessionRef, Outcome, Readiness, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { buildCodexRemoteResumeCommand } from "../../agent-argv/codex.ts";
import type { LaunchHost, LaunchRequest, NativeLaunch, SessionAdapter, WorkCompletion, WorkReceipt } from "../contracts.ts";
import { getStateDb } from "../../state/db.ts";
import { openHostPane, type HostPaneLaunch, type HostPaneOpened } from "../herdr-pane.ts";
import { readReservation } from "../session-store.ts";
import { CODEX_ATTACH_READ_MS, CODEX_ATTACH_READS, CODEX_INIT_TURN_TIMEOUT_MS } from "../timeouts.ts";
import { workDigest } from "../work-submissions.ts";
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

export type PaneLaunch = HostPaneLaunch;
export type PaneOpened = HostPaneOpened;

/** A launch or terminal attach that has not finished, with everything it already made. */
export type UnresolvedLaunch = {
  kind: "launch" | "resume";
  profile: string;
  cwd: string;
  /** Holds the cwd on the connection that started the thread. */
  reservation?: LaunchReservation;
  threadId?: string;
  result?: unknown;
  initTurn?: string;
  initDone?: boolean;
  pane?: PaneOpened;
};

export type CodexSessionDeps = {
  now(): number;
  clock: CodexClock;
  initTurnTimeoutMs: number;
  /** How long a headless work turn is waited on before its outcome is left unknown. */
  workTurnTimeoutMs: number;
  /** Where the app server listens; a terminal attaches there. Without it only headless sessions run. */
  endpoint?: CodexEndpoint;
  openPane(launch: PaneLaunch): Promise<Outcome<PaneOpened>>;
  /** Positive evidence that the terminal shows the thread: any one of `evidence` on screen. A folder-trust prompt is not. */
  confirmAttached(opened: PaneOpened, expected: { threadId: string; evidence: string[] }, host?: LaunchHost): Promise<Outcome<void>>;
  unresolved: Map<string, UnresolvedLaunch>;
  /** Reservations with a launch or resume running now, keyed like `unresolved`. */
  inFlight: Set<string>;
  /** Whether the launcher's persisted reservation has resolved (bound) or been given up (abandoned), so nothing waits on it here. */
  reservationSettled(reservationId: string): boolean;
};

const ATTACH_READS = CODEX_ATTACH_READS;
const ATTACH_READ_MS = CODEX_ATTACH_READ_MS;
/** Long enough to identify a message, short enough to fit one terminal row unwrapped. */
const EVIDENCE_CHARS = 48;

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): FaultCode => (err instanceof CodexControlError ? err.code : "transient");
const failFrom = <T>(err: unknown, prefix = ""): Outcome<T> => fail(codeOf(err), `${prefix}${messageOf(err)}`);
const home = (): string => process.env.HOME ?? homedir();
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Reads the pane until any of the thread's evidence shows, collapsing the terminal's wrapping. */
export async function awaitCodexHistory(
  read: () => Promise<string | null>, evidence: string[], opts: { attempts: number; sleep(): Promise<void> },
): Promise<Outcome<void>> {
  const wanted = evidence.map(flat).filter((e) => e !== "");
  if (wanted.length === 0) return fail("not-ready", "the thread has no history a terminal could show");
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    if (attempt > 0) await opts.sleep();
    const screen = await read();
    if (screen !== null && wanted.some((w) => flat(screen).includes(w))) return ok(undefined);
  }
  return fail("not-ready", "the terminal never showed the thread's history; a folder-trust prompt or a failed start is holding it");
}

function messageText(item: Record<string, unknown>): string | undefined {
  if (item.type === "agentMessage") return typeof item.text === "string" ? item.text : undefined;
  if (item.type !== "userMessage" || !Array.isArray(item.content)) return undefined;
  const parts = item.content.filter((c) => isRecord(c) && c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * What a resumed terminal shows last: the newest turn's user and agent
 * messages. A terminal scrolls its oldest history away, so the first message
 * is no evidence once real work has run. Each candidate is one short line,
 * stripped of the markdown marks the terminal renders away.
 */
export function attachEvidence(thread: Record<string, unknown>): string[] {
  const turns = Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : [];
  for (const turn of [...turns].reverse()) {
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    const last = (type: string) => [...items].reverse().map((i) => (i.type === type ? messageText(i) : undefined)).find(text);
    const user = last("userMessage");
    const agent = last("agentMessage");
    const lines = (s: string) => s.split("\n").map((l) => flat(l.replace(/[*`]/g, ""))).filter((l) => l !== "");
    const found = [
      ...(user ? [lines(user)[0]!.slice(0, EVIDENCE_CHARS)] : []),
      ...(agent ? [lines(agent).at(-1)!.slice(-EVIDENCE_CHARS)] : []),
    ].filter((e) => e !== "");
    if (found.length > 0) return found;
  }
  return [];
}

function defaultDeps(): CodexSessionDeps {
  return {
    now: Date.now,
    clock: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as Timer) },
    initTurnTimeoutMs: CODEX_INIT_TURN_TIMEOUT_MS,
    workTurnTimeoutMs: 6 * 60 * 60_000,
    unresolved: UNRESOLVED,
    inFlight: IN_FLIGHT,
    reservationSettled: (id) => {
      const state = readReservation(getStateDb(), id)?.state;
      return state === "bound" || state === "abandoned";
    },
    openPane: openHostPane,
    confirmAttached: async (opened, expected, host) => {
      const [{ herdrRequest }, { parsePaneRef }] = await Promise.all([
        import("../../herdr/client.ts"), import("../../../packages/rt-client/src/pane-ref.ts"),
      ]);
      const request = host?.herdr?.request ?? herdrRequest;
      const pane = parsePaneRef(opened.pane).paneId;
      const read = async () => {
        const screen = await request<{ read?: { text?: unknown } }>(
          "pane.read", { pane_id: pane, source: "visible" }, opened.socket ? { sockPath: opened.socket } : {},
        );
        return screen.ok && typeof screen.result.read?.text === "string" ? screen.result.read.text : null;
      };
      return awaitCodexHistory(read, expected.evidence, {
        attempts: ATTACH_READS, sleep: () => new Promise((r) => setTimeout(r, ATTACH_READ_MS)),
      });
    },
  };
}

export type LoaderStatus =
  | { state: "never" } | { state: "live" } | { state: "closed" } | { state: "failed"; message: string };

/** An installed binary and a live connection to its app server; readiness never starts or probes that server. */
export function codexReadiness(
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
  exists: (path: string) => boolean = existsSync,
  connection: LoaderStatus = shared?.status() ?? { state: "never" },
): Readiness {
  if (which("codex") === null && !exists(join(home(), ".local", "bin", "codex"))) {
    return { ready: false, reason: "Codex is not installed: there is no codex on PATH or in ~/.local/bin" };
  }
  switch (connection.state) {
    case "live": return { ready: true };
    case "never": return { ready: false, reason: "rt has no connection to the Codex app server yet" };
    case "closed": return { ready: false, reason: "rt's connection to the Codex app server closed" };
    case "failed": return { ready: false, reason: `rt cannot reach the Codex app server: ${connection.message}` };
  }
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

/**
 * Unfinished launches and attaches, keyed by profile and reservation id. They
 * outlive the connection: a thread may exist even when the connection that
 * asked for it closed before the reply could arrive.
 */
const UNRESOLVED = new Map<string, UnresolvedLaunch>();
const IN_FLIGHT = new Set<string>();

export function createCodexSessions(control: CodexControl, overrides: Partial<CodexSessionDeps> = {}): CodexSessionAdapter {
  const deps: CodexSessionDeps = { ...defaultDeps(), ...overrides };
  const hub = codexEventHub(control);
  const unresolved = deps.unresolved;
  const ref = (value: string): NativeSessionRef => ({ harness: HARNESS, profile: control.profile, kind: "id", value });
  const keyOf = (reservationId: string) => `${control.profile}\0${reservationId}`;

  /**
   * One operation per reservation at a time. A second call while one is in
   * flight would see a half-made entry and could start a second thread or
   * open a second pane, so it is refused before it touches anything.
   */
  async function exclusive<T>(key: string, reservationId: string, run: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    if (deps.inFlight.has(key)) {
      return fail("ambiguous", `a launch for reservation ${reservationId} is still in progress; try again once it finishes`);
    }
    deps.inFlight.add(key);
    try {
      return await run();
    } finally {
      deps.inFlight.delete(key);
    }
  }

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

  function settle(key: string, entry: UnresolvedLaunch): void {
    unresolved.delete(key);
    entry.reservation?.release();
  }

  /** Drops every idle entry whose persisted reservation no longer waits on it. */
  function dropSettled(): void {
    for (const [key, entry] of unresolved) {
      if (deps.inFlight.has(key)) continue;
      if (deps.reservationSettled(key.slice(key.indexOf("\0") + 1))) settle(key, entry);
    }
  }

  /** Opens the terminal once per entry; a retry re-checks the pane it already opened. */
  async function attach(
    entry: UnresolvedLaunch, threadId: string, evidence: string[], reservationId: string, host?: LaunchHost,
  ): Promise<Outcome<Pick<NativeLaunch, "attachment" | "surface">>> {
    if (!entry.pane) {
      let command: string;
      try {
        // The terminal only draws the thread: its tools run in the app server, so the launch's env would reach nothing there.
        command = buildCodexRemoteResumeCommand(entry.cwd, { socketPath: deps.endpoint!.socketPath, threadId });
      } catch (err) {
        return fail("invalid", messageOf(err));
      }
      const opened = await deps.openPane({ cwd: entry.cwd, command, reservationId, ...(host !== undefined && { host }) });
      if (!opened.ok) return opened;
      entry.pane = opened.data;
    }
    const shown = await deps.confirmAttached(entry.pane, { threadId, evidence }, host);
    if (!shown.ok) {
      return fail("not-ready", `Codex opened in pane ${entry.pane.pane} but has not attached to thread ${threadId}: ${shown.error.message}. Retry with reservation ${reservationId} to check that pane again`);
    }
    const { pane, socket, tabId, workspaceId } = entry.pane;
    const surface = { ...(tabId !== undefined && { tabId }), ...(workspaceId !== undefined && { workspaceId }) };
    return ok({
      attachment: { mode: "herdr", pane, ...(socket !== undefined && { socket }) },
      ...(Object.keys(surface).length > 0 && { surface }),
    });
  }

  /** Creates the thread unless this entry already has one, or Codex has not said whether it made one. */
  async function create(entry: UnresolvedLaunch, key: string, params: Record<string, unknown>, reservationId: string): Promise<Outcome<void>> {
    let reservation = entry.reservation;
    if (reservation?.state === "unknown") {
      return fail("ambiguous", `Codex has not said whether reservation ${reservationId} created a thread; rt will not start a second one`);
    }
    if (reservation?.state === "started" && reservation.threadId) {
      entry.threadId = reservation.threadId;
      entry.result = reservation.result;
      return ok(undefined);
    }
    if (!reservation || reservation.state !== "reserved") {
      reservation?.release();
      const reserved = control.reserveLaunch(entry.cwd);
      if (!reserved.ok) return reserved;
      reservation = entry.reservation = reserved.data;
    }
    try {
      entry.result = await control.request("thread/start", params);
      entry.threadId = reservation.threadId;
      return ok(undefined);
    } catch (err) {
      if (reservation.state === "unknown") {
        return fail("ambiguous", `Codex did not answer thread/start for ${entry.cwd}; the launch stays reserved until it is reconciled (${messageOf(err)})`);
      }
      settle(key, entry);
      return failFrom(err);
    }
  }

  /** Waits for the initialization turn, starting one only when this connection has seen none. */
  async function initialize(entry: UnresolvedLaunch, threadId: string, reservationId: string): Promise<Outcome<void>> {
    const created = `Codex created thread ${threadId}, but `;
    const retry = `; retry with reservation ${reservationId} to carry on with that thread`;
    if (!entry.initTurn) {
      const seen = hub.turns(threadId);
      if (seen.completed) entry.initDone = true;
      else if (seen.active) entry.initTurn = seen.active;
      else {
        let turnId: unknown;
        try {
          const started = await control.request("turn/start", { threadId, input: [{ type: "text", text: CODEX_INIT_PROMPT }] });
          turnId = isRecord(started) && isRecord(started.turn) ? started.turn.id : undefined;
        } catch (err) {
          return failFrom(err, `${created}its initialization turn did not start${retry}: `);
        }
        if (!text(turnId)) return fail("invalid", `${created}its initialization turn came back without an id${retry}`);
        entry.initTurn = turnId;
      }
    }
    if (entry.initDone) return ok(undefined);
    const ended = await hub.waitTurn(threadId, entry.initTurn!, deps.clock, deps.initTurnTimeoutMs);
    if (ended === undefined) return fail("ambiguous", `${created}its initialization turn has not finished yet${retry}`);
    if (ended !== "completed") {
      entry.initTurn = undefined;
      return fail("not-ready", `${created}its initialization turn ended ${ended}${retry}`);
    }
    entry.initDone = true;
    return ok(undefined);
  }

  return {
    carriesReservations: true,
    async launch(request) {
      const checked = checkRequest(request);
      if (!checked.ok) return checked;
      const cwd = checked.data;
      const params = startParams(cwd, request.selection.options);
      if (!params.ok) return params;

      const key = keyOf(request.reservationId);
      return exclusive(key, request.reservationId, async () => {
        dropSettled();
        let entry = unresolved.get(key);
        if (entry && (entry.kind !== "launch" || entry.cwd !== cwd)) {
          return fail("invalid", `reservation ${request.reservationId} is held for another ${entry.kind} in ${entry.cwd}`);
        }
        if (!entry) {
          for (const held of unresolved.values()) {
            if (held.kind === "launch" && held.profile === control.profile && held.cwd === cwd) {
              return fail("refused", `an earlier Codex launch in ${cwd} has not finished, so rt will not start another thread there`);
            }
          }
          const reserved = control.reserveLaunch(cwd);
          if (!reserved.ok) return reserved;
          entry = { kind: "launch", profile: control.profile, cwd, reservation: reserved.data };
          unresolved.set(key, entry);
        }

        if (!entry.threadId) {
          const made = await create(entry, key, params.data, request.reservationId);
          if (!made.ok) return made;
        }
        const threadId = entry.threadId!;
        control.adopt(threadId);
        const initialized = await initialize(entry, threadId, request.reservationId);
        if (!initialized.ok) return initialized;

        const settings = settingsOf(entry.result);
        if (request.mode === "headless") {
          settle(key, entry);
          return ok({ native: ref(threadId), attachment: { mode: "headless" }, settings });
        }
        const attached = await attach(entry, threadId, [CODEX_INIT_PROMPT], request.reservationId, request.host);
        if (!attached.ok) return attached;
        settle(key, entry);
        return ok({ native: ref(threadId), ...attached.data, settings });
      });
    },

    async resume(native, request) {
      const valid = checkRef(native);
      if (!valid.ok) return valid;
      const checked = checkRequest(request);
      if (!checked.ok) return checked;
      const cwd = checked.data;
      const threadId = native.value;
      const key = keyOf(request.reservationId);
      return exclusive(key, request.reservationId, async () => {
        dropSettled();
        const pending = unresolved.get(key);
        if (pending && (pending.kind !== "resume" || pending.threadId !== threadId || pending.cwd !== cwd)) {
          return fail("invalid", `reservation ${request.reservationId} is held for another ${pending.kind} in ${pending.cwd}`);
        }
        control.adopt(threadId);

        let read: unknown;
        try {
          read = await control.request("thread/read", { threadId, includeTurns: request.mode === "herdr" });
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

        const evidence = attachEvidence(thread);
        if (evidence.length === 0) return fail("not-ready", `thread ${threadId} has no history yet, so a terminal cannot resume it`);
        const entry = pending ?? { kind: "resume", profile: control.profile, cwd, threadId };
        const attached = await attach(entry, threadId, evidence, request.reservationId, request.host);
        if (!attached.ok) {
          if (entry.pane) unresolved.set(key, entry);
          return attached;
        }
        settle(key, entry);
        return ok({ native, ...attached.data, settings });
      });
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

    /** One turn on the bound thread. Codex answering with an error refused it; a timeout or a dropped connection may have started it. */
    async startWork(binding, input): Promise<Outcome<WorkReceipt>> {
      const valid = checkRef(binding.native);
      if (!valid.ok) return valid;
      if (control.closed) return fail("not-ready", "the Codex control connection is closed, so nothing was sent");
      const threadId = binding.native.value;
      control.adopt(threadId);
      let started: unknown;
      try {
        started = await control.request("turn/start", { threadId, input: [{ type: "text", text: input.text }] });
      } catch (err) {
        if (err instanceof CodexControlError && err.code !== "transient" && err.code !== "invalid") return failFrom(err);
        return fail("ambiguous", `Codex may have started a turn on thread ${threadId}: ${messageOf(err)}`);
      }
      const turnId = isRecord(started) && isRecord(started.turn) && text(started.turn.id) ? started.turn.id : undefined;
      if (turnId === undefined) return fail("ambiguous", `Codex answered turn/start on thread ${threadId} without a turn id`);
      const receipt: WorkReceipt = { id: input.id, evidence: "submitted", nativeId: threadId, turnId };
      if (binding.attachment.mode !== "headless") return ok(receipt);
      const completion: Promise<WorkCompletion> = hub.waitTurn(threadId, turnId, deps.clock, deps.workTurnTimeoutMs)
        .then((status) => (status === undefined ? null : {
          exitCode: status === "completed" ? 0 : 1, body: JSON.stringify({ threadId, turnId, status }),
        }));
      return ok({ ...receipt, completion });
    },

    /** The thread's own history is the evidence: a turn whose user message is the submitted text. */
    async reconcileWork(binding, probe) {
      const valid = checkRef(binding.native);
      if (!valid.ok) return valid;
      if (control.closed) return fail("transient", "the Codex control connection is closed");
      const threadId = binding.native.value;
      control.adopt(threadId);
      let read: unknown;
      try {
        read = await control.request("thread/read", { threadId, includeTurns: true });
      } catch (err) {
        return failFrom(err, `Codex could not read thread ${threadId}: `);
      }
      const turns = Array.isArray(threadOf(read)?.turns) ? (threadOf(read)!.turns as unknown[]).filter(isRecord) : [];
      for (const turn of [...turns].reverse()) {
        const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
        const sent = items.some((item) => item.type === "userMessage" && workDigest(messageText(item) ?? "") === probe.digest);
        if (sent) return ok({ id: probe.id, evidence: "submitted", nativeId: threadId, ...(text(turn.id) && { turnId: turn.id }) });
      }
      return ok(null);
    },
  };
}

/** Stands in when no connection could be made, so each operation reports why. */
function unavailableSessions(error: { code: FaultCode; message: string }): SessionAdapter {
  const refused = async () => ({ ok: false as const, error });
  // With no connection nothing can have been sent, whatever made the connection fail.
  const unsent = async () => ({ ok: false as const, error: { code: "not-ready" as const, message: error.message } });
  return { launch: refused, resume: refused, observe: refused, startWork: unsent, discover: async () => [] };
}

export type CodexSessionLoaderDeps = {
  env: NodeJS.ProcessEnv;
  now(): number;
  discover(): Promise<Outcome<CodexEndpoint>>;
  connect(options: CodexControlOptions): Promise<CodexControl>;
  sessions: Partial<CodexSessionDeps>;
};

export type CodexSessionLoader = {
  load(): Promise<SessionAdapter>;
  status(): LoaderStatus;
};

/** The wait after the first failed connection attempt; each further failure doubles it, up to the cap. */
export const DISCOVERY_BACKOFF_MS = 15_000;
export const DISCOVERY_BACKOFF_CAP_MS = 300_000;

const controlLog: CodexControlLog = (level, message, fields) => {
  if (level !== "warn") return;
  void import("../../ui/warn.ts").then(({ warn }) => warn("codex-control", message, { context: fields }));
};

/**
 * One live connection per loader; a closed one is replaced on the next load.
 * A failed attempt is answered from cache until its backoff ends, so a
 * poller ticking against a stopped app server spawns and connects nothing.
 */
export function createCodexSessionLoader(overrides: Partial<CodexSessionLoaderDeps> = {}): CodexSessionLoader {
  const deps: CodexSessionLoaderDeps = {
    env: process.env,
    now: Date.now,
    discover: () => discoverCodexEndpoint(),
    connect: (options) => connectCodexControl(options, { log: controlLog }),
    sessions: {},
    ...overrides,
  };
  let current: { control: CodexControl; adapter: SessionAdapter } | undefined;
  let opening: Promise<SessionAdapter> | undefined;
  let failure: { error: { code: FaultCode; message: string }; attempts: number; retryAt: number; adapter: SessionAdapter } | undefined;

  function failed(error: { code: FaultCode; message: string }): SessionAdapter {
    const attempts = (failure?.attempts ?? 0) + 1;
    const wait = Math.min(DISCOVERY_BACKOFF_MS * 2 ** (attempts - 1), DISCOVERY_BACKOFF_CAP_MS);
    failure = { error, attempts, retryAt: deps.now() + wait, adapter: unavailableSessions(error) };
    return failure.adapter;
  }

  async function open(): Promise<SessionAdapter> {
    const endpoint = await deps.discover();
    if (!endpoint.ok) return failed(endpoint.error);
    let control: CodexControl;
    try {
      control = await deps.connect({ socketPath: endpoint.data.socketPath, profile: canonicalCodexProfile(undefined, deps.env) });
    } catch (err) {
      return failed({ code: codeOf(err), message: messageOf(err) });
    }
    failure = undefined;
    const adapter = createCodexSessions(control, { ...deps.sessions, endpoint: endpoint.data });
    current = { control, adapter };
    return adapter;
  }

  return {
    load() {
      if (current && !current.control.closed) return Promise.resolve(current.adapter);
      if (failure && deps.now() < failure.retryAt) return Promise.resolve(failure.adapter);
      return (opening ??= open().finally(() => {
        opening = undefined;
      }));
    },
    status() {
      if (current && !current.control.closed) return { state: "live" };
      if (failure) return { state: "failed", message: failure.error.message };
      return current ? { state: "closed" } : { state: "never" };
    },
  };
}

let shared: CodexSessionLoader | undefined;

export function loadCodexSessions(): Promise<SessionAdapter> {
  return (shared ??= createCodexSessionLoader()).load();
}
