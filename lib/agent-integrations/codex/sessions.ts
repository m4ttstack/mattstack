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
 * Headless mode is the same owned thread with no terminal. A terminal only
 * attaches in a folder Codex already trusts (`trust.ts`), checked before
 * anything is made.
 *
 * Every launch or attach that does not finish stays recorded under its
 * reservation id with whatever it already made (the thread, the init turn,
 * the pane). A retry with the same reservation id carries on from there;
 * nothing here starts a second thread or opens a second pane to cover an
 * unfinished or unknown result.
 *
 * Limit: tools run in the user-started app server, whose env rt cannot set, so a worker's gate identity comes from its binding.
 *
 * A connection hears a thread's item events only once it started or resumed
 * that thread (live-03 probe-events.jsonl), and its subscription keeps the
 * thread loaded after the thread's terminal quits, where queued input then
 * runs headless (live-04). So with agent.integrations.enabled on, rt holds a
 * subscription only while the thread has deliveries awaiting confirmation (a
 * queue/add in flight or queued rows, held again for those rows when a
 * connection opens), lets it go when the last is confirmed or after HOLD_MS,
 * and lets a Herdr launch's own subscription go once its terminal attached.
 * A pending question holds the thread the same way until it ends or the
 * window passes, and is held again before it is answered (`questions.ts`).
 * Threads rt runs headless keep theirs. The subscription is `thread/resume`
 * with nothing but the thread id and `excludeTurns`: the method table refuses
 * every override field, so it re-decides no settings (gate spike G6, hooks
 * follow-up), adds no turn, and a question it replays is never answered
 * unless a gate answers it. A thread that is not loaded is never resumed,
 * since that would load it with no terminal: it is reported gone instead, as
 * an unload, close or sessionEnd hook heard later is. A close is an unload:
 * Codex closes a thread about 60 s after its last subscriber leaves (live-04),
 * terminal quit or not, so it detaches the binding and never signs the
 * session out; only the sessionEnd hook ends one. A Herdr attachment is
 * live only while herdr shows codex in its pane, checked at each observe; a
 * headless one only while its thread is known loaded, since rt's own
 * subscription is what keeps it so, and observe makes that subscription
 * again when a connection failed to.
 *
 * This adapter never assigns a herd job and never writes the session store;
 * what a gone thread means for its binding and presence is `lifecycle`'s.
 */

import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import type {
  FaultCode, Mode, NativeSessionRef, Outcome, Readiness, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { buildCodexRemoteResumeCommand } from "../../agent-argv/codex.ts";
import type {
  LaunchHost, LaunchRequest, MessageAdapter, NativeLaunch, QuestionAdapter, SessionAdapter, WorkCompletion, WorkReceipt,
} from "../contracts.ts";
import { getStateDb } from "../../state/db.ts";
import { integrationsEnabled } from "../switch.ts";
import { openHostPane, type HostPaneLaunch, type HostPaneOpened } from "../herdr-pane.ts";
import { isDetachedAttachment, listAttachedBindings, readReservation } from "../session-store.ts";
import { CODEX_ATTACH_READ_MS, CODEX_ATTACH_READS, CODEX_INIT_TURN_TIMEOUT_MS } from "../timeouts.ts";
import { workDigest } from "../work-submissions.ts";
import {
  CodexControlError, connectCodexControl, discoverCodexEndpoint,
  type CodexClock, type CodexControl, type CodexControlLog, type CodexControlOptions, type CodexEndpoint, type LaunchReservation,
} from "./control.ts";
import { DELIVERY_SWEEP_INTERVAL_MS, MAX_DELIVERY_BACKOFF_TICKS } from "../delivery.ts";
import { listQueuedFrames } from "../delivery-store.ts";
import { codexEventHub } from "./events.ts";
import type { CodexMessagingDeps } from "./messaging.ts";
import { createCodexQuestions, type CodexQuestionDeps } from "./questions.ts";
import { observeCodexHookEvent } from "./policy-receipts.ts";
import { setCodexExperimentalProbe, setCodexLinkProbe, setCodexThreadProbe, setCodexTurnProbe } from "./link.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { CODEX_STATUS_ENUMS, isRecord, type CodexEvent, type CodexThreadStatus } from "./protocol.ts";
import { codexConfigPath, codexFolderTrust } from "./trust.ts";

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
  /** Owns a bound thread on this connection for another facet, unless it was released at this attachment or a later one. */
  adopt(binding: SessionBinding): Outcome<void>;
  /** Releases a bound thread: its events stop arriving, and only a later attachment, launch or resume owns it again. */
  disown(binding: SessionBinding): void;
  /**
   * While the switch is on, keeps this connection subscribed to the bound
   * thread until hold `id` is released or its window ends; refused when
   * Codex has not loaded the thread.
   */
  hold(binding: SessionBinding, id: string): Promise<Outcome<void>>;
  /** While the switch is on, subscribes a thread rt runs headless and keeps it subscribed, since only rt keeps it loaded. */
  keep(binding: SessionBinding): Promise<Outcome<void>>;
  /** Delivery `id` is confirmed or given up: the last one out unsubscribes a thread rt does not run itself. */
  release(threadId: string, id: string): void;
  /** Whether delivery `id` still holds its thread's subscription, so its echo can still arrive. */
  held(threadId: string, id: string): boolean;
  /** Whether the binding can take input now: its thread loaded and, for a Herdr attachment, codex in its pane at the last observe. */
  live(binding: SessionBinding): boolean | undefined;
  /** Asks herdr now whether codex runs in a Herdr attachment's pane; a failed check is false. */
  paneLive(binding: SessionBinding): Promise<boolean>;
  /** The turn this connection saw start and not yet end on the bound thread; undefined when it saw none. */
  activeTurn(binding: SessionBinding): string | undefined;
}

/** unloaded: the app server no longer runs the thread, or closed it (a close follows every unload, live-04). ended: its sessionEnd hook ran. */
export type CodexThreadGone = "unloaded" | "ended";

/** dropped: the resume finished after rt let the thread go, so it was undone at once. */
type SubscribeResult = "subscribed" | "unloaded" | "unknown" | "dropped";

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
  /** Positive evidence that the terminal shows the thread: any one of `evidence` on screen. */
  confirmAttached(opened: PaneOpened, expected: { threadId: string; evidence: string[] }, host?: LaunchHost): Promise<Outcome<void>>;
  unresolved: Map<string, UnresolvedLaunch>;
  /** The config where the profile's Codex records the folders the person trusts; undefined when none can be located. */
  trustConfig(profile: string): string | undefined;
  /** Reservations with a launch or resume running now, keyed like `unresolved`. */
  inFlight: Set<string>;
  /** Whether the launcher's persisted reservation has resolved (bound) or been given up (abandoned), so nothing waits on it here. */
  reservationSettled(reservationId: string): boolean;
  /** agent.integrations.enabled: bound threads are subscribed, and reported gone, only while it is on. */
  enabled(): boolean;
  /** Reports a bound thread gone; `generation` is the attachment that saw it, when one did. True when its binding was detached or ended. */
  lifecycle(native: NativeSessionRef, event: CodexThreadGone, generation?: number): Promise<boolean>;
  /** Whether herdr shows codex running in a Herdr attachment's pane now; false when herdr cannot say. */
  paneRuns(binding: SessionBinding): Promise<boolean>;
};

/** How long one delivery keeps its thread subscribed: the interval the queued recheck saturates at. */
const HOLD_MS = DELIVERY_SWEEP_INTERVAL_MS * MAX_DELIVERY_BACKOFF_TICKS;

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
  return fail("not-ready", "the terminal never showed the thread's history; a failed start or a dialog is holding it");
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
    trustConfig: (profile) => codexConfigPath(profile, process.env),
    reservationSettled: (id) => {
      const state = readReservation(getStateDb(), id)?.state;
      return state === "bound" || state === "abandoned";
    },
    enabled: integrationsEnabled,
    lifecycle: async (native, event, generation) => {
      const { reportSessionGone } = await import("../presence.ts");
      return reportSessionGone(native, event, generation);
    },
    paneRuns: async (binding) => {
      const [{ herdrRequest }, { bindingPaneRuns }] = await Promise.all([
        import("../../herdr/client.ts"), import("../../daemon/pane-input.ts"),
      ]);
      return bindingPaneRuns(herdrRequest, binding);
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

/**
 * Both modes run on an owned app-server thread, so both launch, resume and
 * observe, and both take peer input through the native queue, which starts an
 * idle thread and holds input for a working one's next boundary (spike 2026-10-04).
 */
export function codexSupported(_mode: Mode): Array<
  "launch" | "resume" | "observe" | "peer-idle" | "peer-working" | "questions-form" | "question-recovery"
> {
  return ["launch", "resume", "observe", "peer-idle", "peer-working", "questions-form", "question-recovery"];
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

/** What a native event says about the thread's end, if anything. */
function goneBy(event: CodexEvent): CodexThreadGone | undefined {
  switch (event.method) {
    case "thread/status/changed":
      return event.status.type === "notLoaded" ? "unloaded" : undefined;
    case "thread/closed":
      return "unloaded";
    case "hook/started":
    case "hook/completed":
      return event.run.eventName === "sessionEnd" ? "ended" : undefined;
    default:
      return undefined;
  }
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
  /** Threads disowned, by the attachment generation they were released at. */
  const released = new Map<string, number>();
  const own = (threadId: string): void => {
    released.delete(threadId);
    control.adopt(threadId);
  };
  /** Threads this connection started or resumed, so their item events reach it, until it unsubscribes or Codex unloads them. */
  const subscribed = new Set<string>();
  /** Threads rt runs with no terminal: rt's subscription is what keeps them loaded, so only a release ends it. */
  const headless = new Set<string>();
  /** Deliveries awaiting confirmation, by thread, each with the timer that lets it go after HOLD_MS. */
  const holders = new Map<string, Map<string, unknown>>();
  /** Subscriptions being made now, so concurrent holds resume a thread once. */
  const subscribing = new Map<string, Promise<SubscribeResult>>();
  /** What herdr last showed in each Herdr attachment's pane, by thread and the generation that was checked. */
  const panes = new Map<string, { generation: number; live: boolean }>();

  function dropHolders(threadId: string): void {
    for (const timer of holders.get(threadId)?.values() ?? []) deps.clock.clearTimeout(timer);
    holders.delete(threadId);
  }

  /** Ends this connection's subscription to a thread it owns; a thread it does not own is never named. */
  function unsubscribe(threadId: string): void {
    dropHolders(threadId);
    headless.delete(threadId);
    subscribed.delete(threadId);
    if (control.closed || !control.owns(threadId)) return;
    control.request("thread/unsubscribe", { threadId }).catch(() => {});
  }

  /** The last outstanding delivery confirmed or timed out: a thread rt does not run itself is let go. */
  function release(threadId: string, id: string): void {
    const held = holders.get(threadId);
    if (!held?.has(id)) return;
    deps.clock.clearTimeout(held.get(id));
    held.delete(id);
    if (held.size > 0) return;
    holders.delete(threadId);
    if (subscribed.has(threadId) && !headless.has(threadId)) unsubscribe(threadId);
  }

  /** A detach or an end rt applied lets the thread go: it is unsubscribed but stays owned, so its status still arrives. */
  async function reportGone(threadId: string, event: CodexThreadGone, generation?: number): Promise<void> {
    let applied = false;
    try {
      applied = await deps.lifecycle(ref(threadId), event, generation);
    } catch {
      return;
    }
    if (applied) unsubscribe(threadId);
  }

  // A policy receipt counts as proof only once Codex itself reports the hook run.
  hub.listen((event) => observeCodexHookEvent(event));

  hub.listen((event) => {
    const gone = goneBy(event);
    if (!gone) return;
    subscribed.delete(event.threadId);
    if (deps.enabled()) void reportGone(event.threadId, gone);
  });

  /** The thread's status, read off the thread and kept in the hub. */
  async function readStatus(threadId: string): Promise<CodexThreadStatus | undefined> {
    let status: CodexThreadStatus | undefined;
    try {
      status = threadStatus(threadOf(await control.request("thread/read", { threadId, includeTurns: false }))?.status);
    } catch {
      return undefined;
    }
    if (status) hub.refresh(threadId, status);
    return status;
  }

  /**
   * Reads the thread's status and, when the app server has it loaded,
   * subscribes this connection with a bare resume. An unloaded thread is
   * reported gone and left unloaded, since resuming would load it with no
   * terminal (live-04). A failed read or resume leaves it unsubscribed.
   */
  async function subscribeThread(threadId: string, generation: number): Promise<SubscribeResult> {
    if (subscribed.has(threadId)) return "subscribed";
    if (control.closed) return "unknown";
    const status = await readStatus(threadId);
    if (!status) return "unknown";
    if (status.type === "notLoaded") {
      await reportGone(threadId, "unloaded", generation);
      return "unloaded";
    }
    let resumed: unknown;
    try {
      resumed = await control.request("thread/resume", { threadId, excludeTurns: true });
    } catch {
      return "unknown";
    }
    const thread = threadOf(resumed);
    if (thread?.id !== threadId) return "unknown";
    if (!wanted(threadId)) {
      dropSubscription(threadId);
      return "dropped";
    }
    subscribed.add(threadId);
    const now = threadStatus(thread.status);
    if (now) hub.refresh(threadId, now);
    return "subscribed";
  }

  /** rt still owns the thread and something still needs its events: a delivery hold, or rt running it headless. */
  function wanted(threadId: string): boolean {
    return control.owns(threadId) && (holders.has(threadId) || headless.has(threadId));
  }

  /**
   * Undoes a resume that finished after rt let the thread go (a disown, a
   * detach or an end while it was in flight). Ownership is taken back only
   * for the one request, since the subscription is rt's own to end.
   */
  function dropSubscription(threadId: string): void {
    subscribed.delete(threadId);
    if (control.closed) return;
    const owned = control.owns(threadId);
    if (!owned) control.adopt(threadId);
    control.request("thread/unsubscribe", { threadId }).catch(() => {});
    if (!owned) control.disown(threadId);
  }

  /**
   * Keeps this connection subscribed to the binding's thread while delivery
   * `id` awaits confirmation, so its echo arrives: until `release`, or
   * HOLD_MS, after which only the thread's history can confirm it. A thread
   * Codex has not loaded refuses the hold, so nothing is queued to it.
   */
  async function hold(binding: SessionBinding, id: string): Promise<Outcome<void>> {
    const owned = adopt(binding);
    if (!owned.ok) return owned;
    if (!deps.enabled()) return ok(undefined);
    const threadId = binding.native.value;
    const held = holders.get(threadId) ?? new Map<string, unknown>();
    holders.set(threadId, held);
    if (held.has(id)) deps.clock.clearTimeout(held.get(id));
    held.set(id, deps.clock.setTimeout(() => release(threadId, id), HOLD_MS));
    const result = await subscribeOnce(threadId, binding.attachment.generation);
    if (result === "unloaded") {
      release(threadId, id);
      return fail("not-ready", `Codex is not running thread ${threadId} now, so nothing was sent`);
    }
    if (result === "dropped" || !holders.get(threadId)?.has(id)) {
      release(threadId, id);
      return fail("stale-binding", `rt let go of thread ${threadId} while subscribing to it, so nothing was sent`);
    }
    // A failed subscribe is no hold: the delivery still goes out, and the thread's history is where its echo is found.
    if (result === "unknown") forget(threadId, id);
    return ok(undefined);
  }

  function subscribeOnce(threadId: string, generation: number): Promise<SubscribeResult> {
    let pending = subscribing.get(threadId);
    if (!pending) {
      pending = subscribeThread(threadId, generation).finally(() => subscribing.delete(threadId));
      subscribing.set(threadId, pending);
    }
    return pending;
  }

  /** Drops one hold without touching the subscription. */
  function forget(threadId: string, id: string): void {
    const held = holders.get(threadId);
    if (!held?.has(id)) return;
    deps.clock.clearTimeout(held.get(id));
    held.delete(id);
    if (held.size === 0) holders.delete(threadId);
  }

  /** Subscribes a thread rt runs headless, which only rt's subscription keeps loaded; no release lets it go. */
  async function keep(binding: SessionBinding): Promise<Outcome<void>> {
    const owned = adopt(binding);
    if (!owned.ok) return owned;
    if (!deps.enabled()) return ok(undefined);
    const threadId = binding.native.value;
    const marked = headless.has(threadId);
    headless.add(threadId);
    const result = await subscribeOnce(threadId, binding.attachment.generation);
    if (result === "subscribed") return ok(undefined);
    // Only this keep's own mark comes off, and only while nothing subscribed the thread meanwhile: a headless launch or resume marks what it subscribes.
    if (!marked && !subscribed.has(threadId)) headless.delete(threadId);
    return fail(result === "unloaded" ? "not-ready" : "transient", `rt could not subscribe to headless thread ${threadId} (${result})`);
  }

  /** Asks herdr now whether codex runs in the binding's pane, and records the answer for `live`; a failed check is no evidence. */
  async function paneLive(binding: SessionBinding): Promise<boolean> {
    let shown = false;
    try {
      shown = await deps.paneRuns(binding);
    } catch {
      shown = false;
    }
    panes.set(binding.native.value, { generation: binding.attachment.generation, live: shown });
    return shown;
  }

  /** Herdr attachments are live only with fresh pane evidence; a headless one only while its thread is known loaded, since only rt's subscription keeps it so. */
  function live(binding: SessionBinding): boolean | undefined {
    const threadId = binding.native.value;
    const loaded = hub.live(threadId) === true;
    if (binding.attachment.mode !== "herdr") return loaded;
    const pane = panes.get(threadId);
    return loaded && pane?.generation === binding.attachment.generation && pane.live;
  }

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
    const cwd = resolve(request.cwd);
    if (request.mode === "herdr") {
      const trusted = codexFolderTrust(deps.trustConfig(control.profile), cwd);
      if (!trusted.ok) return trusted;
    }
    return ok(cwd);
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
      if (entry.threadId) subscribed.add(entry.threadId);
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

  function adopt(binding: SessionBinding): Outcome<void> {
    const valid = checkRef(binding.native);
    if (!valid.ok) return valid;
    const threadId = binding.native.value;
    const at = released.get(threadId);
    if (at !== undefined && at >= binding.attachment.generation) {
      return fail("stale-binding", `thread ${threadId} was released at attachment ${at}, so attachment ${binding.attachment.generation} cannot take it back`);
    }
    if (!control.owns(threadId)) own(threadId);
    return ok(undefined);
  }

  return {
    carriesReservations: true,
    adopt,
    hold,
    keep,
    release,
    held: (threadId, id) => holders.get(threadId)?.has(id) === true,
    live,
    paneLive,
    activeTurn: (binding) => hub.turns(binding.native.value).active,
    disown(binding) {
      if (!checkRef(binding.native).ok) return;
      const threadId = binding.native.value;
      released.set(threadId, Math.max(released.get(threadId) ?? 0, binding.attachment.generation));
      unsubscribe(threadId);
      control.disown(threadId);
    },
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
        own(threadId);
        const initialized = await initialize(entry, threadId, request.reservationId);
        if (!initialized.ok) return initialized;

        const settings = settingsOf(entry.result);
        if (request.mode === "headless") {
          headless.add(threadId);
          settle(key, entry);
          return ok({ native: ref(threadId), attachment: { mode: "headless" }, settings });
        }
        const attached = await attach(entry, threadId, [CODEX_INIT_PROMPT], request.reservationId, request.host);
        if (!attached.ok) {
          if (deps.enabled() && !holders.has(threadId)) unsubscribe(threadId);
          return attached;
        }
        settle(key, entry);
        // The terminal now keeps its thread loaded; rt's own subscription would keep it loaded after the terminal quits (live-04).
        if (deps.enabled() && !holders.has(threadId)) unsubscribe(threadId);
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
        own(threadId);

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
          subscribed.add(threadId);
          headless.add(threadId);
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
      if (deps.enabled()) {
        if (binding.attachment.mode === "headless" && !isDetachedAttachment(binding) && !subscribed.has(threadId) && hub.live(threadId) !== false) {
          // A keep the connection failed at is made again here; it reads the status itself and reports an unloaded thread gone.
          await keep(binding);
        } else {
          // Status changes reach a connection that is not subscribed (live-04), so one read keeps the hub current.
          if (!hub.view(threadId)) await readStatus(threadId);
          if (hub.live(threadId) === false) await reportGone(threadId, "unloaded", binding.attachment.generation);
        }
        if (binding.attachment.mode === "herdr") await paneLive(binding);
      } else if (!hub.view(threadId)) {
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
      // A Herdr thread whose terminal quit can stay loaded and would run the turn headless (live-04).
      if (deps.enabled() && binding.attachment.mode === "herdr" && !(await paneLive(binding))) {
        return fail("refused", `codex is not running in pane ${binding.attachment.pane ?? "(none)"} for thread ${threadId}, so no turn was started`);
      }
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
  messaging: Partial<CodexMessagingDeps>;
  questions: Partial<CodexQuestionDeps>;
  /** The state db the default `outstanding` and `headless` read. */
  db(): Database;
  /** Attached Codex bindings with deliveries still queued at their current attachment, and those deliveries' ids; held each time a connection opens. */
  outstanding(): Array<{ binding: SessionBinding; ids: string[] }>;
  /** Attached Codex bindings rt runs headless; each is subscribed again, and kept, when a connection opens. */
  headless(): SessionBinding[];
};

export type CodexSessionLoader = {
  load(): Promise<SessionAdapter>;
  /** Messaging on the sessions' own connection, so both share its one event subscription. */
  loadMessaging(): Promise<MessageAdapter>;
  /** The live connection's question adapter, which has listened for native questions since that connection opened. */
  loadQuestions(): Promise<QuestionAdapter>;
  status(): LoaderStatus;
  /** The live connection's id, or null; never connects. */
  connection(): string | null;
  /** Whether the live connection negotiated experimentalApi; undefined without one. Never connects. */
  experimentalApi(): boolean | undefined;
  /** Whether the binding can take input, as the live connection knows it; undefined without a connection for its profile. Never connects. */
  bindingLive(binding: SessionBinding): boolean | undefined;
  /** The bound thread's running turn as the live connection saw it; undefined without a connection for its profile. Never connects. */
  activeTurn(binding: SessionBinding): string | undefined;
};

/** Stands in when no connection could be made: nothing was answered, so the completion stays pending. */
function unavailableQuestions(message: string): QuestionAdapter {
  return { complete: async () => ({ ok: false, error: { code: "not-ready", message } }) };
}

/** Stands in when no connection could be made; nothing can have been sent. */
function unavailableMessaging(message: string): MessageAdapter {
  const error = { code: "not-ready" as const, message };
  return { submit: async () => ({ ok: false, error }), reconcile: async () => ({ ok: false, error }) };
}

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
    messaging: {},
    questions: {},
    db: () => getStateDb(),
    headless: () => (integrationsEnabled() ? listAttachedBindings(deps.db(), HARNESS).filter((b) => b.attachment.mode === "headless") : []),
    outstanding: () => {
      if (!integrationsEnabled()) return [];
      const db = deps.db();
      return listAttachedBindings(db, HARNESS)
        .map((binding) => ({ binding, ids: listQueuedFrames(db, binding.key, binding.attachment.generation) }))
        .filter((o) => o.ids.length > 0);
    },
    ...overrides,
  };
  let current: {
    control: CodexControl; adapter: CodexSessionAdapter; questions: QuestionAdapter; messaging?: Promise<MessageAdapter>;
  } | undefined;
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
    // Listening from the first event: a question already pending is replayed as soon as a hold resumes its thread.
    const questions = createCodexQuestions(control, { sessions: adapter, ...deps.questions });
    current = { control, adapter, questions };
    await Promise.all([keepHeadless(adapter, control.profile), holdOutstanding(adapter, control.profile)]);
    return adapter;
  }

  /** A headless thread an earlier connection kept loaded unloads about 60 s after that connection closes (live-04) unless this one subscribes. */
  async function keepHeadless(adapter: CodexSessionAdapter, profile: string): Promise<void> {
    let bindings: SessionBinding[];
    try {
      bindings = deps.headless().filter((b) => b.native.harness === HARNESS && b.native.profile === profile && b.attachment.mode === "headless");
    } catch {
      return;
    }
    await Promise.all(bindings.map((b) => adapter.keep(b).catch(() => undefined)));
  }

  /** A new connection hears no echo of a delivery an earlier one queued until it holds that delivery's thread itself. */
  async function holdOutstanding(adapter: CodexSessionAdapter, profile: string): Promise<void> {
    let outstanding: Array<{ binding: SessionBinding; ids: string[] }>;
    try {
      outstanding = deps.outstanding().filter((o) => o.binding.native.harness === HARNESS && o.binding.native.profile === profile);
    } catch {
      return;
    }
    await Promise.all(outstanding.flatMap((o) => o.ids.map((id) => adapter.hold(o.binding, id).catch(() => undefined))));
  }

  function load(): Promise<SessionAdapter> {
    if (current && !current.control.closed) return Promise.resolve(current.adapter);
    if (failure && deps.now() < failure.retryAt) return Promise.resolve(failure.adapter);
    return (opening ??= open().finally(() => {
      opening = undefined;
    }));
  }

  return {
    load,
    async loadMessaging() {
      await load();
      const live = current && !current.control.closed ? current : undefined;
      if (!live) return unavailableMessaging(failure?.error.message ?? "rt has no connection to the Codex app server");
      return (live.messaging ??= import("./messaging.ts").then(({ createCodexMessaging }) =>
        createCodexMessaging(live.control, {
          adopt: (binding) => live.adapter.adopt(binding),
          hold: (binding, id) => live.adapter.hold(binding, id),
          release: (threadId, id) => live.adapter.release(threadId, id),
          held: (threadId, id) => live.adapter.held(threadId, id),
          ...deps.messaging,
        })));
    },
    async loadQuestions() {
      await load();
      const live = current && !current.control.closed ? current : undefined;
      return live?.questions ?? unavailableQuestions(failure?.error.message ?? "rt has no connection to the Codex app server");
    },
    status() {
      if (current && !current.control.closed) return { state: "live" };
      if (failure) return { state: "failed", message: failure.error.message };
      return current ? { state: "closed" } : { state: "never" };
    },
    connection() {
      return current && !current.control.closed ? current.control.connection : null;
    },
    experimentalApi() {
      return current && !current.control.closed ? current.control.experimental : undefined;
    },
    bindingLive(binding) {
      if (!current || current.control.closed || current.control.profile !== binding.native.profile) return undefined;
      return current.adapter.live(binding);
    },
    activeTurn(binding) {
      if (!current || current.control.closed || current.control.profile !== binding.native.profile) return undefined;
      return current.adapter.activeTurn(binding);
    },
  };
}

let shared: CodexSessionLoader | undefined;

function sharedLoader(): CodexSessionLoader {
  if (!shared) {
    const loader = createCodexSessionLoader();
    shared = loader;
    setCodexLinkProbe(() => loader.connection());
    setCodexThreadProbe((binding) => loader.bindingLive(binding));
    setCodexTurnProbe((binding) => loader.activeTurn(binding));
    setCodexExperimentalProbe(() => loader.experimentalApi());
  }
  return shared;
}

export function loadCodexSessions(): Promise<SessionAdapter> {
  return sharedLoader().load();
}

export function loadCodexMessaging(): Promise<MessageAdapter> {
  return sharedLoader().loadMessaging();
}

export function loadCodexQuestions(): Promise<QuestionAdapter> {
  return sharedLoader().loadQuestions();
}
