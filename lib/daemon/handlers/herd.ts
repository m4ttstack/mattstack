/**
 * herd:* ... the shepherd's run registry. Every verb is a composition of
 * existing handlers (gate, chat, agent, worktree) so the herd owns no
 * delivery, CAS, or spawn semantics of its own.
 */
import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import type { Logger } from "pino";
import type { Commands, GateQuestion, GateRow, HerdStatusData } from "../../../packages/rt-client/src/commands.ts";
import { formatPaneRef, gatePresentation, parsePaneRef } from "../../../packages/rt-client/src/index.ts";
import type { CommandResult } from "./types.ts";
import type { HerdStore, HerdJobRow, HerdRow, JobAttempt } from "../herd-store.ts";
import { writePromptFile } from "../../agent-argv/index.ts";
import { fillSpawnSlots } from "../../herd-brief.ts";
import { currentJobAttempt, herdPrefix, herdSubject, isValidJobName, mintHerdId } from "../herd-store.ts";
import type { GatesStore } from "../gates-store.ts";
import type { RunningRunScan } from "../../runs/store.ts";
import type { createGateHandlers } from "./gate.ts";
import { isValidQuestion, openAskedGate } from "./gate.ts";
import type { createChatHandlers } from "./chat.ts";
import type { AgentStartOutcome, AttemptLaunch, createAgentHandlers } from "./agent.ts";
import type { CallerContext, Capability, HarnessId, Mode, Outcome, Selection } from "../../../packages/rt-client/src/agent-integrations.ts";
import { resolveCallerContextNow, type CallerEvidence } from "../../agent-integrations/context.ts";
import { POLICY_CAPABILITIES } from "../../agent-integrations/policy-readiness.ts";
import { builtinRegistry, UNRECORDED_PANE_HARNESS } from "../../agent-integrations/builtins.ts";
import type { IntegrationRegistry } from "../../agent-integrations/contracts.ts";
import { createSessionStore, isDetachedAttachment, listBindingsByAgent, listBindingsByNativeValue } from "../../agent-integrations/session-store.ts";
import { harnessEnabled, integrationsEnabled } from "../../agent-integrations/switch.ts";
import { getStateDb } from "../../state/db.ts";
import { loadRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { createJobAttempts, type JobAttempts } from "../herd-attempts.ts";
import { classifyJobObservation } from "../herd-watchdog.ts";
import { createJobObserver, type ObserveJob } from "../herd-watchdog-adapters.ts";
import { chooseJobWorker, configuredWorkerSelection, type JobWorker, type SelectionDeps } from "../herd-selection.ts";
import type { herdrRequest } from "../../herdr/client.ts";
import type { HerdrRunner } from "../../agent-herdr.ts";
import { slugifyChatName } from "../../chat-room-name.ts";
import { baseOfHandle } from "../../chat-names.ts";
import { readChatSession, writeChatSession } from "../../chat-session.ts";
import { attendPane } from "../attend.ts";
import type { TrustOutcome } from "../trust-accept.ts";
import { BG_SESSION } from "../bg-service.ts";
import { paneStatuses } from "../pane-statuses.ts";
import type { BgService } from "../bg-service.ts";
import type { BgClaimsStore } from "../bg-claims-store.ts";

const herdOwner = (herdId: string): string => `herd:${herdId}`;

/** What a spawn's trust check actually established, reported rather than
    swallowed: no modal was in the way, one was accepted and verified gone,
    one is still up (the job is parked at `stuck-at-modal`), or herdr could
    not be read and the pane's state is genuinely unknown. */
export type { TrustOutcome } from "../trust-accept.ts";

export interface HerdDeps {
  store: HerdStore;
  gateStore: Pick<GatesStore, "get" | "markConsumed">;
  gate: Pick<ReturnType<typeof createGateHandlers>, "gate:open" | "gate:list" | "gate:close" | "gate:subscribe" | "gate:subscriptions" | "gate:unsubscribe">;
  chat: Pick<ReturnType<typeof createChatHandlers>, "chat:sign-in" | "chat:sign-out" | "chat:join" | "chat:post" | "chat:archive" | "chat:rooms">;
  /** `startAttempt` is the agent service's in-process start under a job attempt, used while agent.integrations.enabled is on. */
  agent: Pick<ReturnType<typeof createAgentHandlers>, "agent:start"> & {
    startAttempt?: (payload: unknown, attempt: AttemptLaunch) => Promise<AgentStartOutcome>;
  };
  worktree: { "worktree:provision": (payload: any) => Promise<any>; "worktree:dispose": (payload: any) => Promise<any> };
  runWorktree: (runId: string) => string | null;
  /** Live-run lookup by worktree path, for herd:close's advisory warning; wired from `findRunningRunByWorktree` in lib/runs/store.ts. */
  findRunningRunByWorktree: (worktree: string) => RunningRunScan;
  /** The chat identity a session already holds, or null; wired from `presenceForSession` in lib/state/presence-store.ts. */
  presenceIdentityForSession: (session: string) => { handle: string; baseHandle: string; name: string } | null;
  /** Mints a worker identity whose display name is the job name, bound to no session yet; wired from `mintIdentity` in lib/state/identity-store.ts. */
  mintWorkerId: (job: string) => string;
  /** Display names for ids, every missing id mapping to itself; wired from `identityNames` in lib/state/identity-store.ts. */
  identityNames: (ids: Iterable<string>) => Map<string, string>;
  /** The id a typed name or id reaches; wired from `resolveHandle` in lib/state/identity-store.ts. */
  resolveHandle: (x: string) => string;
  /** Whether the shepherd session's own inbox socket is currently accepting connections; wired from `probeInboxReachability` in lib/daemon/inbox.ts over `resolveInbox`'s binding. */
  probeInbox: (session: string) => Promise<"reachable" | "unreachable">;
  herdr: typeof herdrRequest;
  herdrRunnerFor: (socket: string | null) => HerdrRunner;
  lifecycle: { connected(socket: string | null): boolean; watch(socket: string): void; sweepClaims(): Promise<void> };
  bg: BgService;
  claims: BgClaimsStore;
  jobsRoot: string;
  /** The daemon's herd watchdog, read for herd:status's per-job ladder; absent
      when no watchdog is wired (tests, a daemon booting without one). */
  watchdog?: { annotations(herd: string, job: string): { strikes: number; lastPokeAt: number | null } | null };
  log: Logger;
  /** agent.integrations.enabled, read per call; tests inject it. */
  integrationsEnabled?: () => boolean;
  /** The job attempts over this store; built over the daemon's state.db when omitted. */
  attempts?: JobAttempts;
  /** Resolves a report's caller evidence; the daemon's state.db when omitted. */
  resolveCaller?: (evidence: CallerEvidence) => Outcome<CallerContext>;
  /** The state.db holding session bindings; the daemon's when omitted. */
  sessionDb?: () => Database;
  /** A tree's worktree registry record by name; the repo's registry when omitted. */
  jobTree?: (repo: string, tree: string) => Pick<TreeRecord, "path" | "branch" | "owner" | "state" | "releasedAt"> | null;
  /** The harnesses a worker selection is checked against; the built-ins when omitted. */
  integrations?: IntegrationRegistry;
  /** The harnesses the user enabled; Claude Code plus agent.provider when omitted. */
  enabledHarnesses?: () => HarnessId[];
  /** The configured default worker, read on every spawn. */
  defaultSelection?: () => Selection;
  /** The value a launch fills an unset model or effort with; the agent.<harness>.<option> setting when omitted. */
  launchDefault?: SelectionDeps["launchDefault"];
  /** Ends a headless worker's session, named by its binding key, through its integration. */
  endSession?: (bindingKey: string) => Promise<Outcome<void>>;
  /** Observes a bound worker through its integration; the shared observation store over the daemon's state.db when omitted. */
  observeJob?: ObserveJob;
}

/** `own` is the attempt the session was launched for, found even when its binding has since moved on. */
type WorkerCall = { herdId?: string; name?: string; named?: boolean; session?: string; harness?: string; caller?: Outcome<CallerContext>; own?: JobAttempt };
type WorkerRefusal = { ok: false; error: string; failure: { code: string; message: string } };

export const SHEPHERD_HANDLE = "shepherd";
export { SYSTEM_HANDLE } from "../system-handle.ts";
export const MILESTONE_OPTIONS = ["Approve", "Revise", "Spawn a reviewer"] as const;

/** Herd questions only: every other gate (MR review, pipeline, board) carries
    rich option text through the shared gate store, so this cap never moves
    into gate:open or normalizeGateQuestions. */
export const HERD_OPTION_LABEL_MAX = 60;

/** The chat_* MCP tools resolve identity only from the session file, which
    only the CLI's sign-in writes; a session the daemon signed in has no file
    unless it is written here. A file already naming this handle is kept (it
    may carry the CLI's room and cwd); one naming another handle is stale and
    would make every chat_* call act as a handle the session no longer owns. */
function recordChatSession(log: Logger, sessionId: string, identity: { handle: string; baseHandle: string; name: string }): void {
  try {
    const existing = readChatSession(sessionId);
    if (existing?.handle === identity.handle && existing.name === identity.name) return;
    writeChatSession({ ...existing, sessionId, ...identity, signedInAt: Date.now() });
  } catch (err) {
    log.warn({ err, sessionId }, "herd: could not write the chat session file; chat_* tools will not resolve this session");
  }
}
const RECOMMENDED_TAIL = /\s*\(\s*recommended\s*\)\s*$/i;

function overlongOptionLabel(questions: GateQuestion[]): string | undefined {
  for (const q of questions) {
    for (const o of q.options ?? []) {
      const label = (typeof o === "string" ? o : (o.label || o.value)).replace(RECOMMENDED_TAIL, "");
      if (label.length > HERD_OPTION_LABEL_MAX) {
        return `option label "${label.slice(0, 20)}..." is ${label.length} characters (max ${HERD_OPTION_LABEL_MAX}) in question "${q.id}": give each option a short label and put the detail in its description ({"value","label","description"})`;
      }
    }
  }
  return undefined;
}

const HERD_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
// The old in-spawn retry's budget, now passed to agent:start's own trust
// driver (RT-156) as trustWaitMs instead of running a second driver here.
const TRUST_BUDGET_MS = 15_000;
// The job statuses that only a running worker reaches, and therefore the only
// ones whose missing agent proves the worker session died rather than never
// having started.
const LIVE_WORKER_STATUSES: ReadonlySet<string> = new Set(["active", "at-gate", "at-milestone"]);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
/** A bare pane id headed into a gate's `pane` field: formatted per the herd's
    hidden-ness so the ref rides addressably wherever that field surfaces
    (display, focus/resume, and now `origin.paneId`). */
const refPane = (bare: string | undefined, hidden: boolean): string | undefined => (bare ? formatPaneRef(bare, hidden ? "bg" : "visible") : undefined);

/** herd:ask/milestone's origin: a resolvable pane names it, with the shared
    presentation rule deciding whether the question fits the native form
    (gate-push's Escape seam dismisses it there) or must wait for an answer
    from elsewhere. No resolvable pane (no --pane, no job.pane on record)
    means no origin at all, and owner derivation falls back to human as
    before. Callers still nudge the worker's session regardless of
    presentation: gate-push delivers only to nudge.session, and that push is
    a herd worker's only wake after it ends its turn on `rt herd ask` --
    herd workers never run `rt gate wait`. Malformed questions skip
    presentation (default "wait") rather than call gatePresentation, which
    assumes shape gate:open has not yet validated; gate:open's own question
    check runs right after and is what actually refuses them. */
const herdOrigin = (paneRef: string | undefined, session: string, questions: GateQuestion[]): { paneId: string; presentation: "form" | "wait" } | undefined =>
  paneRef
    ? { paneId: paneRef, presentation: Array.isArray(questions) && questions.every(isValidQuestion) ? gatePresentation({ paneId: paneRef, sessionId: session, questions }) : "wait" }
    : undefined;

export function workspaceLabel(herdId: string): string { return `herd: ${herdId}`; }
export function roomName(herdId: string): string { return slugifyChatName(`herd-${herdId}`); }
export function jobDir(jobsRoot: string, herdId: string, job: string): string { return join(jobsRoot, herdId, job); }

export function createHerdHandlers(deps: HerdDeps) {
  const { store, log } = deps;
  const enabled = deps.integrationsEnabled ?? integrationsEnabled;
  const sessionDb = deps.sessionDb ?? (() => getStateDb("daemon"));
  const jobTree = deps.jobTree ?? ((repo: string, tree: string) => loadRegistry(repo).find((t) => t.name === tree) ?? null);
  const attempts = deps.attempts ?? createJobAttempts({ herds: store, db: sessionDb, enabled });
  const resolveCaller = deps.resolveCaller ?? ((evidence: CallerEvidence) => resolveCallerContextNow(evidence, { db: sessionDb() }));
  const registry = deps.integrations ?? builtinRegistry();
  const enabledHarnesses = deps.enabledHarnesses ?? (() => {
    const on = harnessEnabled();
    return registry.list().map((i) => i.id).filter(on);
  });
  const defaultSelection = deps.defaultSelection ?? configuredWorkerSelection;
  const endSession = deps.endSession ?? (async (bindingKey: string): Promise<Outcome<void>> => {
    const binding = createSessionStore(sessionDb()).get(bindingKey);
    if (!binding) return { ok: false, error: { code: "invalid", message: `no session binding has key ${bindingKey}` } };
    const integration = registry.get(binding.native.harness);
    const sessions = await integration?.loadSessions?.();
    if (!sessions?.end) return { ok: false, error: { code: "unsupported", message: `${integration?.label ?? binding.native.harness} cannot end a session rt runs` } };
    return sessions.end(binding);
  });
  const observeJob = deps.observeJob ?? createJobObserver({ db: sessionDb, integrations: registry }).observeJob;

  /** A bound worker's liveness from its own integration's observation; a failed observe is unknown. */
  async function observedLiveness(attempt: JobAttempt): Promise<ReturnType<typeof classifyJobObservation>> {
    try {
      const seen = await observeJob(attempt);
      return seen.ok ? classifyJobObservation(attempt, seen.data, Date.now()) : "unknown";
    } catch (err) {
      log.warn({ err, attempt: attempt.id }, "herd: could not observe a bound worker");
      return "unknown";
    }
  }

  /**
   * The worker a spawn launches. Off, every worker is a Claude Code pane, as
   * before; a request for anything else refuses rather than running there.
   * On, see herd-selection.ts. Either way nothing has been made yet.
   */
  async function workerFor(herdId: string, name: string, p: Commands["herd:spawn"]["payload"] | undefined, fenced: boolean): Promise<Outcome<JobWorker>> {
    const refuse = (message: string): Outcome<JobWorker> => ({ ok: false, error: { code: "invalid", message } });
    const assignment = p?.assignment;
    if (assignment !== undefined && (typeof assignment !== "object" || assignment === null || !str(assignment.harness))) {
      return refuse("assignment must name a harness");
    }
    if (p?.mode !== undefined && p.mode !== "herdr" && p.mode !== "headless") return refuse(`invalid mode "${String(p.mode)}"; must be one of herdr, headless`);
    const optionsOf = (o: { model?: unknown; effort?: unknown; account?: unknown } | undefined): Selection["options"] => ({
      ...(str(o?.model) && { model: o!.model as string }), ...(str(o?.effort) && { effort: o!.effort as string }), ...(str(o?.account) && { account: o!.account as string }),
    });
    const asked = optionsOf(p);
    const callerAccount = str(p?.callerAccount);
    if (!fenced) {
      const other = [str(p?.harness), str(assignment?.harness)].find((h) => h !== undefined && h !== "claude");
      if (other !== undefined || p?.mode === "headless") {
        return { ok: false, error: { code: "refused", message: `a ${other ?? "headless"} herd worker needs agent integrations switched on (agent.integrations.enabled); with them off, every herd worker is a Claude Code pane` } };
      }
      const options = assignment ? optionsOf(assignment) : asked;
      if (options.account === undefined && callerAccount !== undefined) options.account = callerAccount;
      return { ok: true, data: { selection: { harness: "claude", options }, mode: "herdr" } };
    }
    const latest = store.attempts(herdId, name).at(-1);
    const persisted = latest && { selection: latest.selection, mode: latest.mode };
    const harness = str(p?.harness);
    const required: Capability[] = ["launch", ...POLICY_CAPABILITIES];
    return chooseJobWorker({
      ...(assignment && { explicit: { harness: assignment.harness, options: optionsOf(assignment) } }),
      ...(harness !== undefined && { proposed: { harness, options: asked } }),
      ...(harness === undefined && Object.keys(asked).length > 0 && { proposedOptions: asked }),
      fallback: defaultSelection(), enabled: enabledHarnesses(), required,
      ...(p?.mode !== undefined && { mode: p.mode as Mode }),
      ...(persisted && { persisted }),
      ...(callerAccount !== undefined && { callerAccount }),
    }, { registry, ...(deps.launchDefault && { launchDefault: deps.launchDefault }) });
  }

  /**
   * A worker call's verified session, and the job it acts for: what it names,
   * with any half it leaves out (a headless worker has no HERD_ID or
   * HERD_JOB) taken from its session's attempt. authorizeWorker then checks
   * that attempt holds that job, which refuses a named job it does not.
   */
  function workerCall(p: { herd?: unknown; job?: unknown; session?: unknown; harness?: unknown } | undefined): WorkerCall {
    let herdId = str(p?.herd); let name = str(p?.job);
    const named = herdId !== undefined && name !== undefined;
    const session = str(p?.session);
    const harness = str(p?.harness);
    if (!session) return { herdId, name, named };
    const caller = resolveCaller({ native: { harness: harness ?? "claude", kind: "id", value: session } });
    const ownId = caller.ok ? caller.data.binding.attemptId
      : caller.error.code === "stale-binding" ? movedOnAttempt(harness ?? "claude", session) : undefined;
    const own = ownId !== undefined ? store.getAttempt(ownId) : null;
    if (own) { herdId ??= own.herd; name ??= own.job; }
    return { herdId, name, named, session, ...(harness !== undefined && { harness }), caller, ...(own && { own }) };
  }

  /** The attempt a session's binding was launched for, when that binding has moved on (a replaced worker's ended session); only one binding may name it. */
  function movedOnAttempt(harness: string, session: string): string | undefined {
    const launched = listBindingsByNativeValue(sessionDb(), session)
      .filter((b) => b.native.harness === harness && b.native.kind === "id" && b.attemptId !== undefined);
    return launched.length === 1 ? launched[0]!.attemptId : undefined;
  }

  /** A call that names no job is refused for its unresolved session when it has one, rather than for the missing job. */
  function unattributed(w: WorkerCall, what: string): WorkerRefusal | null {
    if (!w.caller || w.caller.ok) return null;
    const error = `this ${what} cannot be attributed to a session: ${w.caller.error.message}`;
    return { ok: false, error, failure: { code: w.caller.error.code, message: error } };
  }

  /**
   * A job whose active attempt is unbound (spawned with the switch off) keeps
   * the pre-integration rule: the call names the job and comes from the
   * session its row records. Otherwise the session's own attempt must hold
   * the job, and a session an unbound attempt ran under, since replaced, is
   * stale.
   */
  function authorizeWorker(w: WorkerCall, herdId: string, name: string, job: HerdJobRow, what: string): WorkerRefusal | null {
    const refuse = (code: string, error: string): WorkerRefusal => ({ ok: false, error, failure: { code, message: error } });
    const active = store.activeAttempt(herdId, name);
    const replaced = w.session !== undefined && !w.caller?.ok
      ? store.attempts(herdId, name).find((a) => a.id !== active?.id && a.bindingKey === undefined && a.legacySession === w.session)
      : undefined;
    const stale = (id: string) => refuse("stale-binding", `job "${name}" did not accept this ${what}: attempt ${id} no longer holds job ${name}; a newer worker replaced it`);
    if (active && active.bindingKey === undefined) {
      if (w.named && w.harness === undefined && w.session !== undefined && w.session === job.agentSession) return null;
      if (replaced) return stale(replaced.id);
      return refuse("refused", `job "${name}" did not accept this ${what}: it is not from the session that works the job`);
    }
    if (replaced) return stale(replaced.id);
    if (!w.caller) return refuse("ambiguous", `this ${what} cannot be attributed to a session, so its job did not accept it`);
    if (!w.caller.ok) {
      const gone = w.own && w.own.herd === herdId && w.own.job === name && (w.own.state === "replaced" || w.own.state === "ended");
      return gone ? stale(w.own!.id) : refuse(w.caller.error.code, `this ${what} cannot be attributed to a session: ${w.caller.error.message}`);
    }
    const held = attempts.authorizeJobReport(w.caller.data, herdId, name);
    return held.ok ? null : refuse(held.error.code, `job "${name}" did not accept this ${what}: ${held.error.message}`);
  }

  /** Never throws: a pane close or a session end that fails must not block the caller's own bookkeeping. */
  async function closeWorker(herd: HerdRow, job: HerdJobRow): Promise<boolean> {
    // Off, no integration is ever loaded: a worker is a pane, closed as it always was.
    const attempt = enabled() ? store.activeAttempt(herd.id, job.name) : null;
    if (attempt?.mode !== "headless") return job.pane ? closePane(herd.herdrSocket, job.pane, { herd: herd.id, job: job.name }) : false;
    if (!attempt.bindingKey) {
      log.warn({ herd: herd.id, job: job.name, attempt: attempt.id }, "herd: a headless worker with no bound session cannot be ended");
      return false;
    }
    try {
      const ended = await endSession(attempt.bindingKey);
      if (ended.ok) {
        // An ended attempt holds no worker, so a later close or respawn does not end the session again.
        store.endAttempt(attempt.id, ["active"]);
        return true;
      }
      log.warn({ herd: herd.id, job: job.name, error: ended.error.message }, "herd: headless worker session end failed");
    } catch (err) {
      log.warn({ err, herd: herd.id, job: job.name }, "herd: headless worker session end threw");
    }
    return false;
  }

  /**
   * A worker launched for an attempt that never took its job (its policy
   * unproven, its activation refused) holds nothing, so it is closed and its
   * attempt ended. A worker rt cannot find or close keeps the attempt
   * reserved, which recovery judges and only a new spawn replaces.
   */
  /** What rt did to the worker: its session ended, its pane closed, or null when it could not close it. */
  async function closeUntakenWorker(herd: HerdRow, attemptId: string, mode: Mode, kept: { agentId: string; paneId?: string }): Promise<"session" | "pane" | null> {
    if (store.getAttempt(attemptId)?.state !== "reserved") return null;
    const context = { herd: herd.id, attempt: attemptId, agent: kept.agentId };
    let closed = false;
    const binding = listBindingsByAgent(sessionDb(), kept.agentId).find((b) => b.attemptId === attemptId && !isDetachedAttachment(b));
    const pane = binding?.attachment.pane ?? kept.paneId;
    if (mode === "headless") {
      if (!binding) {
        log.warn(context, "herd: a worker that never took its job has no live session to end");
        return null;
      }
      try {
        const ended = await endSession(binding.key);
        closed = ended.ok;
        if (!ended.ok) log.warn({ ...context, error: ended.error.message }, "herd: could not end a worker that never took its job");
      } catch (err) {
        log.warn({ ...context, err }, "herd: ending a worker that never took its job threw");
      }
    } else if (pane) {
      closed = await closePane(herd.herdrSocket, pane, context);
    }
    if (!closed) return null;
    attempts.endJobAttempt(attemptId);
    return mode === "headless" ? "session" : "pane";
  }

  /**
   * Whether the job's recorded tree is still its own: registered at the same
   * path, on the job's branch, owned by this herd, claimed, and not released
   * by a person through triage.
   */
  function isOwnTree(herd: HerdRow, job: HerdJobRow): boolean {
    if (!job.tree || !job.branch) return false;
    try {
      const rec = jobTree(herd.repo, job.tree);
      return rec !== null && rec.path === job.worktree && rec.branch === job.branch && rec.owner === herdOwner(herd.id)
        && !rec.releasedAt && (rec.state === undefined || rec.state === "claimed");
    } catch (err) {
      log.warn({ err, herd: herd.id, job: job.name, tree: job.tree }, "herd: could not read the job's tree from the worktree registry");
      return false;
    }
  }

  /** Whether a job still has a worker for closeWorker to close. */
  function hasWorker(herdId: string, job: HerdJobRow): boolean {
    return job.pane !== null || (enabled() && store.activeAttempt(herdId, job.name)?.mode === "headless");
  }

  /** Registers both the prefix row (herd:<id>/*, for the shepherd's own job
      gates) and the owner row (routes any gate whose `owner` is this herd,
      regardless of subject -- e.g. a run gate spawned by a job) BEFORE
      dropping `priorSession`'s matching rows -- the herd's shepherdSession
      before this call, passed by the resume caller only. Create-before-delete
      is safe here (never a spurious no-op re-subscribe) because the store's
      dedupe key is (scope, subjectPrefix, ownerRef, session) and `session`
      always differs from `priorSession` when there is one to replace.
      Ordering this way means a failed replacement leaves the prior
      subscription intact instead of a session with no fan-out at all: if the
      owner row fails, the just-created prefix row is rolled back and the
      prior rows are never touched. Prior-row removal is scoped to that ONE
      session deliberately: any OTHER session's herd-prefix or owner
      subscription (a manual `rt gate subscribe`, a board relay) is a
      legitimate co-observer and must survive a resume it had no part in. */
  async function subscribeShepherd(herdId: string, session: string, priorSession?: string | null): Promise<CommandResult<"gate:subscribe">> {
    const ownerRef = herdOwner(herdId);
    const prefix = herdPrefix(herdId);

    const prefixSub = await deps.gate["gate:subscribe"]({ subjectPrefix: prefix, session });
    if (!prefixSub.ok) return prefixSub;
    const ownerSub = await deps.gate["gate:subscribe"]({ scope: "owner", ownerRef, subjectPrefix: "", session });
    if (!ownerSub.ok) {
      await deps.gate["gate:unsubscribe"]({ id: prefixSub.data.id });
      return ownerSub;
    }

    if (priorSession && priorSession !== session) {
      const prior = await deps.gate["gate:subscriptions"]({ live: true, session: priorSession });
      if (prior.ok) {
        for (const sub of prior.data.subscriptions) {
          const sameHerd = sub.scope === "owner" ? sub.ownerRef === ownerRef : sub.subjectPrefix === prefix;
          if (sameHerd) await deps.gate["gate:unsubscribe"]({ id: sub.id });
        }
      }
    }
    return prefixSub;
  }

  async function unreadFor(handle: string, room: string): Promise<number> {
    const res = await deps.chat["chat:rooms"]({ handle });
    if (!res.ok) return 0;
    const row = (res.data.rooms as Array<{ room: string; unread: number }>).find((r) => r.room === room);
    return row?.unread ?? 0;
  }

  async function openHerdGates(herdId: string): Promise<GateRow[]> {
    const res = await deps.gate["gate:list"]({ open: true, subjectPrefix: herdPrefix(herdId) });
    return res.ok ? res.data.gates : [];
  }

  /** Open `run:*` gates whose worktree belongs to one of this herd's jobs --
      shared by `herd:gates` (its own listing) and `herd:resume` (its count
      of what a resumed shepherd is on the hook for). */
  async function listHerdRunGates(herdId: string): Promise<GateRow[]> {
    const runs = await deps.gate["gate:list"]({ open: true, subjectPrefix: "run:" });
    if (!runs.ok) return [];
    const trees = new Set(store.jobs(herdId).map((j) => j.worktree));
    return runs.data.gates.filter((g) => {
      const wt = deps.runWorktree(g.subject.slice("run:".length));
      return wt !== null && trees.has(wt);
    });
  }

  async function statusData(herdId: string): Promise<HerdStatusData | null> {
    const herd = store.get(herdId);
    if (!herd) return null;
    const [panes, gates, unread, subs, pushState] = await Promise.all([
      paneStatuses(deps.herdr, herd.herdrSocket), openHerdGates(herdId), unreadFor(herd.shepherdHandle, herd.room),
      deps.gate["gate:subscriptions"]({ session: herd.shepherdSession }),
      deps.probeInbox(herd.shepherdSession),
    ]);
    const jobRows = store.jobs(herdId);
    const names = deps.identityNames([herd.shepherdHandle, ...jobRows.map((j) => j.handle)]);
    const showWorker = enabled();
    const jobAttempts = new Map(jobRows.map((j) => [j.name, currentJobAttempt(store, herdId, j.name) ?? undefined] as const));
    const observed = new Map<string, ReturnType<typeof classifyJobObservation>>();
    if (showWorker) {
      await Promise.all(jobRows.map(async (j) => {
        const bound = jobAttempts.get(j.name);
        if (bound?.state === "active" && bound.bindingKey !== undefined) observed.set(j.name, await observedLiveness(bound));
      }));
    }
    const jobs = jobRows.map((j: HerdJobRow) => {
      const last = j.lastGate ? deps.gateStore.get(j.lastGate) : null;
      const attempt = showWorker ? jobAttempts.get(j.name) : undefined;
      const harness = jobAttempts.get(j.name)?.selection.harness ?? UNRECORDED_PANE_HARNESS;
      const liveness = observed.get(j.name);
      const paneRow = j.pane ? (panes.get(parsePaneRef(j.pane).paneId) ?? null) : null;
      const ladder = deps.watchdog?.annotations(herdId, j.name) ?? null;
      return {
        ...j,
        handleName: names.get(j.handle) ?? j.handle,
        // Round-trip rule: the row stores the addressable ref (agent:start
        // formats bg spawns; formatPaneRef is idempotent so pre-ref rows and
        // visible bares both come out addressable). The snapshot map keys on
        // the bare id, so the lookup parses.
        pane: j.pane ? formatPaneRef(j.pane, herd.hidden ? "bg" : "visible") : j.pane,
        openGate: gates.find((g) => g.subject === herdSubject(herdId, j.name))?.id ?? null,
        paneStatus: paneRow?.status ?? null,
        // A jetsam sweep kills the agent and leaves its pane shell running, so
        // the job goes on reading active with nothing behind it.
        // Only statuses the worker itself reached count: `spawning` and
        // `stuck-at-modal` legitimately have no agent yet, and a finished job
        // is expected to have none. A bound worker's own integration says
        // instead, and only a confirmed death counts.
        sessionDead: liveness !== undefined ? LIVE_WORKER_STATUSES.has(j.status) && liveness === "dead"
          : paneRow === null ? null : LIVE_WORKER_STATUSES.has(j.status) && paneRow.agent !== harness,
        ...(liveness !== undefined && { liveness }),
        lastGateStatus: last?.status ?? null,
        lastGateDelivery: last?.delivery?.outcome ?? null,
        // released means a lost answer CAS whose pane already reconciled the
        // winning answer -- settled the same as a stamped consumedAt.
        lastGateConsumed: last?.status === "answered" && last.nudge ? last.consumedAt !== null || last.released : null,
        // Off the wire entirely when the job holds no ladder: a null here
        // would read as "the watchdog looked and found nothing", which is
        // also what an unwired watchdog would send.
        ...(ladder ? { watchdog: ladder } : {}),
        ...(attempt && {
          harness: attempt.selection.harness,
          ...(attempt.selection.options.model !== undefined && { model: attempt.selection.options.model }),
          mode: attempt.mode,
        }),
      };
    });
    // A dead row is the shepherd's cue to resume, so the live-only query would
    // hide the very state `renderStatus` prints DEAD for.
    const mine = subs.ok ? subs.data.subscriptions.filter((s) => s.subjectPrefix === herdPrefix(herdId)) : [];
    const subRow = mine.findLast((s) => !s.dead) ?? mine.at(-1) ?? null;
    // Run-gate pushes land on the owner-scoped row, never the prefix row
    // (fanOut's first-match dedupe stops at whichever row matches first), so
    // the freshest delivery for this herd can be sitting on either row.
    const ownerRows = subs.ok ? subs.data.subscriptions.filter((s) => s.scope === "owner" && s.ownerRef === herdOwner(herdId)) : [];
    const ownerRow = ownerRows.findLast((s) => !s.dead) ?? ownerRows.at(-1) ?? null;
    const pushDelivery =
      subRow?.lastDelivery && ownerRow?.lastDelivery
        ? (subRow.lastDelivery.at >= ownerRow.lastDelivery.at ? subRow.lastDelivery : ownerRow.lastDelivery)
        : (subRow?.lastDelivery ?? ownerRow?.lastDelivery ?? null);
    return {
      herd: { ...herd, shepherdName: names.get(herd.shepherdHandle) ?? herd.shepherdHandle }, jobs, unread,
      lifecycleConnected: deps.lifecycle.connected(herd.herdrSocket),
      hiddenUp: herd.hidden ? await deps.bg.up() : null,
      subscription: subRow ? { id: subRow.id, dead: subRow.dead, lastDelivery: subRow.lastDelivery } : null,
      push: { state: pushState, lastDelivery: pushDelivery },
    };
  }

  /** Never throws: a pane that cannot be closed (herdr gone, stale binary,
      non-zero exit) must not block the caller's own bookkeeping. */
  async function closePane(socket: string | null, pane: string, context: Record<string, unknown>): Promise<boolean> {
    try {
      // The row stores the addressable ref (bg:-prefixed on a hidden herd);
      // the herdr CLI only knows the bare pane id.
      const r = await deps.herdrRunnerFor(socket)(["pane", "close", parsePaneRef(pane).paneId]);
      if (r.exitCode === 0) return true;
      log.warn({ ...context, pane, exitCode: r.exitCode }, "herd: pane close failed");
    } catch (err) {
      log.warn({ err, ...context, pane }, "herd: pane close threw");
    }
    return false;
  }

  function uniqueHerdId(name: string): string {
    const base = mintHerdId(name);
    if (!store.get(base)) return base;
    for (let n = 2; ; n++) { const id = `${base}-${n}`; if (!store.get(id)) return id; }
  }

  return {
    "herd:start": async (raw: unknown): Promise<CommandResult<"herd:start">> => {
      const p = raw as Commands["herd:start"]["payload"] | undefined;
      const name = str(p?.name); const repo = str(p?.repo); const session = str(p?.session);
      if (!name || !HERD_NAME_RE.test(name)) return { ok: false, error: `invalid herd name "${p?.name ?? ""}" (must match ${HERD_NAME_RE})` };
      if (!repo) return { ok: false, error: "missing repo" };
      if (!session) return { ok: false, error: "missing session (run inside a Claude Code session, or pass --session)" };
      const hidden = p?.hidden === true;
      const id = uniqueHerdId(name);
      const room = roomName(id);
      let herdrSocket: string | null = null;
      // Awaited before the store row exists, so a failed hidden start leaves
      // no half-registered herd behind.
      if (hidden) {
        const ensured = await deps.bg.ensure();
        herdrSocket = ensured.socket;
      }

      let identity = deps.presenceIdentityForSession(session);
      if (!identity) {
        const signIn = await deps.chat["chat:sign-in"]({ sessionId: session, baseHandle: SHEPHERD_HANDLE, noRoom: true });
        if (!signIn.ok) return signIn;
        identity = { handle: signIn.data.handle, baseHandle: signIn.data.baseHandle, name: signIn.data.name };
      }
      const handle = identity.handle;
      recordChatSession(log, session, identity);
      const join = await deps.chat["chat:join"]({ room, handle });
      if (!join.ok) return join;

      const sub = await subscribeShepherd(id, session);
      if (!sub.ok) return sub;
      store.create({ id, repo, room, workspace: workspaceLabel(id), shepherdSession: session, shepherdHandle: handle, herdrSocket, hidden });
      store.setShepherd(id, { session, handle, pane: p?.callerPane ?? null });
      // The claim is only worth registering once the herd row it belongs to
      // actually exists: any earlier failure returns before this line, so
      // there is no half-created herd to leave an orphaned claim behind for.
      if (hidden) deps.claims.claim(herdOwner(id));
      if (herdrSocket) deps.lifecycle.watch(herdrSocket);
      log.info({ herd: id, room, hidden }, "herd started");
      return { ok: true, data: { herd: id, room, workspace: workspaceLabel(id), subscription: sub.data.id, handle, hidden } };
    },

    "herd:resume": async (raw: unknown): Promise<CommandResult<"herd:resume">> => {
      const p = raw as Commands["herd:resume"]["payload"] | undefined;
      const herdId = str(p?.herd); const session = str(p?.session);
      if (!herdId || !session) return { ok: false, error: "herd and session are required" };
      const herd = store.get(herdId);
      if (!herd) return { ok: false, error: `unknown herd "${herdId}"` };
      const sub = await subscribeShepherd(herdId, session, herd.shepherdSession);
      if (!sub.ok) return sub;
      // signIn refuses to continue an id live in another session; resume is
      // the one takeover, so the replaced shepherd session gives it up first.
      if (herd.shepherdSession !== session) {
        const out = await deps.chat["chat:sign-out"]({ sessionId: herd.shepherdSession });
        if (!out.ok) log.warn({ herd: herdId, error: out.error }, "herd resume: could not sign the prior shepherd session out");
      }
      // A legacy id with no identity row resolves by name, which can reach
      // another herd's newer shepherd; only an id that resolves to itself is
      // this herd's own to continue.
      const stored = herd.shepherdHandle;
      const request = deps.resolveHandle(stored) === stored ? { continue: stored } : { baseHandle: baseOfHandle(stored) };
      const signIn = await deps.chat["chat:sign-in"]({ sessionId: session, ...request, noRoom: true });
      if (!signIn.ok) return signIn;
      if (!signIn.data.continued) {
        const why = "continue" in request ? "the shepherd id is live elsewhere" : "the stored shepherd id resolves to another identity";
        log.warn({ herd: herdId, expected: stored, got: signIn.data.handle }, `herd resume: ${why}; resumed under a new one`);
      }
      const handle = signIn.data.handle;
      recordChatSession(log, session, { handle, baseHandle: signIn.data.baseHandle, name: signIn.data.name });
      const join = await deps.chat["chat:join"]({ room: herd.room, handle });
      if (!join.ok) return join;
      store.setShepherd(herdId, { session, handle, pane: p?.callerPane ?? null });
      const status = (await statusData(herdId))!;
      const gates = [...(await openHerdGates(herdId)), ...(await listHerdRunGates(herdId))];
      return { ok: true, data: { subscription: sub.data.id, gates, unread: status.unread, status, handle } };
    },

    "herd:status": async (raw: unknown): Promise<CommandResult<"herd:status">> => {
      const herdId = str((raw as { herd?: unknown } | undefined)?.herd);
      if (!herdId) return { ok: false, error: "herd is required" };
      const data = await statusData(herdId);
      return data ? { ok: true, data } : { ok: false, error: `unknown herd "${herdId}"` };
    },

    "herd:list": async (raw: unknown): Promise<CommandResult<"herd:list">> => {
      const all = (raw as { all?: unknown } | undefined)?.all === true;
      const rows = all ? store.list() : store.list({ status: "active" });
      const names = deps.identityNames(rows.map((h) => h.shepherdHandle));
      return { ok: true, data: { herds: rows.map((h) => ({ ...h, shepherdName: names.get(h.shepherdHandle) ?? h.shepherdHandle, jobs: store.jobs(h.id).length })) } };
    },

    "herd:close": async (raw: unknown): Promise<CommandResult<"herd:close">> => {
      const p = raw as Commands["herd:close"]["payload"] | undefined;
      const herdId = str(p?.herd); const name = str(p?.job);
      if (!herdId || !name) return { ok: false, error: "herd and job are required" };
      const herd = store.get(herdId);
      const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      await closeWorker(herd, job);
      store.setJobStatus(herdId, name, "closed");
      // Advisory, not a refusal: an abandoned run is resumable, so a running
      // pipeline in the job's worktree is worth flagging but never blocks close.
      // A scan that could not finish gets the same advisory treatment: warn
      // rather than silently reading it as "nothing running".
      const scan = deps.findRunningRunByWorktree(job.worktree);
      const warning =
        scan.kind === "match"
          ? `job worktree has running run ${scan.run.id} at ${scan.run.currentStage}; finish it or run: rt runs abandon ${scan.run.id}`
          : scan.kind === "incomplete"
            ? "could not verify runs; check manually"
            : undefined;
      return { ok: true, data: { job: name, status: "closed", ...(warning && { warning }) } };
    },

    "herd:spawn": async (raw: unknown): Promise<CommandResult<"herd:spawn">> => {
      const p = raw as Commands["herd:spawn"]["payload"] | undefined;
      const herdId = str(p?.herd); const name = str(p?.job);
      if (!herdId || !name) return { ok: false, error: "herd and job are required" };
      if (!isValidJobName(name)) return { ok: false, error: `invalid job name "${name}" (must match ^[a-z][a-z0-9_-]{0,31}$)` };
      const herd = store.get(herdId);
      if (!herd) return { ok: false, error: `unknown herd "${herdId}"` };
      const fenced = enabled();
      if (fenced && !deps.agent.startAttempt) return { ok: false, error: "herd workers launch through the rt daemon's job attempts, which this caller cannot reach" };

      const dir = jobDir(deps.jobsRoot, herdId, name);
      const briefPath = join(dir, "job.md");
      let brief = str(p?.brief);
      if (brief) writePromptFile(dir, "job.md", brief);
      else if (existsSync(briefPath)) {
        brief = readFileSync(briefPath, "utf8");
        // The read-back path tightens modes without rewriting the only copy of the brief.
        chmodSync(dir, 0o700);
        chmodSync(briefPath, 0o600);
      } else return { ok: false, error: `no brief: pass --brief <file> (none stored at ${briefPath})` };

      const shepherdName = deps.identityNames([herd.shepherdHandle]).get(herd.shepherdHandle) ?? herd.shepherdHandle;
      const prompt = fillSpawnSlots(brief, { "shepherd handle": shepherdName, "shepherd id": herd.shepherdHandle });

      // Chosen before anything is made or closed: a refusal leaves the job and its current worker as they were.
      const worker = await workerFor(herdId, name, p, fenced);
      if (!worker.ok) return { ok: false, error: worker.error.message, failure: { code: worker.error.code, message: worker.error.message } };
      const { selection, mode } = worker.data;
      const headless = mode === "headless";

      const prior = store.getJob(herdId, name);
      // Off, the old worker goes first, as it always has: agent:start dedups
      // on the tab label and would focus the dead tab instead of launching.
      if (prior && !fenced) await closeWorker(herd, prior);

      let worktree = str(p?.dir); let branch: string | null = prior?.branch ?? null; let tree: string | null = prior?.tree ?? null;
      // On, a respawn keeps the tree that is still its job's own: provisioning
      // the job's branch again is refused while that tree holds it.
      if (!worktree && fenced && prior && isOwnTree(herd, prior)) worktree = prior.worktree;
      // null = no provisioning happened (--dir, or the job's own tree); false
      // is the cold-create case the caller should announce, since it can take minutes.
      let wasOnDeck: boolean | null = null;
      if (!worktree) {
        const prov = await deps.worktree["worktree:provision"]({ repoName: herd.repo, branch: name, disposal: "job", owner: `herd:${herdId}` });
        if (!prov.ok) return { ok: false, error: `provision failed: ${prov.error}` };
        worktree = prov.data.path as string; branch = prov.data.branch as string; tree = prov.data.tree as string;
        wasOnDeck = prov.data.wasOnDeck === true;
      }
      // A respawn that does not repeat --disposable must not un-dispose a
      // reviewer the shepherd already marked throwaway.
      const disposable = p?.disposable ?? prior?.disposable ?? false;

      const workerId = deps.mintWorkerId(name);
      const predecessor = store.activeAttempt(herdId, name);
      const reserved = attempts.reserveJobAttempt({ herd: herdId, job: name, selection, mode, ...(predecessor && { replaces: predecessor.id }) });
      if (!reserved.ok) {
        if (fenced) return { ok: false, error: `the job's attempt could not be recorded: ${reserved.error.message}` };
        log.warn({ herd: herdId, job: name, error: reserved.error.message }, "herd: job attempt not recorded");
      }
      const attemptId = reserved.ok ? reserved.data.id : undefined;
      // On, the old worker is closed only once its replacement is chosen, placed
      // and reserved, so any refusal above leaves it running and holding the job.
      if (prior && fenced) await closeWorker(herd, prior);
      // The prior pane is closed above, so the row must not go on naming it
      // while agent:start decides whether there is a new one.
      store.upsertJob({ herd: herdId, name, worktree, branch, tree, handle: workerId, status: "spawning", disposable, pane: null, agentSession: null, agentId: null });
      const { model, effort, account } = selection.options;
      const agentPayload = {
        // The selection's harness, never agent:start's own agent.provider
        // default: with the switch off that is always Claude Code.
        provider: selection.harness,
        repo: herd.repo, cwd: worktree, prompt, surface: mode,
        ...(model !== undefined && { model }), ...(effort !== undefined && { effort }), ...(account !== undefined && { account }),
        label: name, caller: `herd:${herdId}`, workspace: herd.workspace, tab: name, handle: workerId,
        subject: herdSubject(herdId, name),
        // A headless worker has no pane line to carry an environment; it learns its job from its bound session instead.
        ...(!headless && { env: { HERD_ID: herdId, HERD_JOB: name, HERD_ROOM: herd.room } }),
        ...(!headless && herd.herdrSocket && { herdrSocket: herd.herdrSocket }),
        // Longer than agent:start's own interactive default: a herd worker's
        // pane is mid worktree-provision when the dialog paints, and the old
        // in-spawn retry gave it 15s before parking stuck-at-modal.
        trustWaitMs: TRUST_BUDGET_MS,
      };
      let started: AgentStartOutcome;
      try {
        started = fenced
          ? await deps.agent.startAttempt!(agentPayload, { id: attemptId!, workId: `herd-work-${attemptId}`, required: [...POLICY_CAPABILITIES] })
          : await deps.agent["agent:start"](agentPayload);
      } finally {
        if (attemptId !== undefined) attempts.release(attemptId);
      }
      if (!started.ok) {
        if (fenced && attemptId !== undefined) {
          // A kept session that never took its job is closed and its attempt ended; one rt cannot close stays reserved for recovery.
          const closed = "kept" in started ? await closeUntakenWorker(herd, attemptId, mode, started.kept) : null;
          if (!("kept" in started)) attempts.endJobAttempt(attemptId);
          // The row names the worker of whichever attempt holds the job: a replacement that never took it gives the row back,
          // and a job no worker holds is crashed, never left spawning.
          const holder = store.activeAttempt(herdId, name);
          const row = store.getJob(herdId, name);
          if (row?.handle === workerId && holder?.id !== attemptId) {
            store.upsertJob(prior && holder
              ? { ...row, handle: prior.handle, agentSession: prior.agentSession, agentId: prior.agentId, status: prior.status }
              : { ...row, status: "crashed" });
          }
          if (!("kept" in started)) return started;
          if (closed === null) return { ok: false, error: started.error };
          const did = closed === "session" ? "rt ended its session and its job attempt" : "rt closed its pane and ended its job attempt";
          return { ok: false, error: `${started.kept.cause}. Agent ${started.kept.agentId} never took job ${name}, so ${did}; nothing of it is left running` };
        }
        // A kept session may have started, so its attempt stays reserved, holding nothing, for recovery to judge.
        if ("kept" in started) return { ok: false, error: started.error };
        if (attemptId !== undefined) attempts.endJobAttempt(attemptId);
        return started;
      }
      if (attemptId !== undefined && !fenced) {
        const activated = attempts.activateUnbound(attemptId);
        if (!activated.ok) log.warn({ herd: herdId, job: name, error: activated.error.message }, "herd: job attempt not activated");
        else store.recordLegacySession(attemptId, started.data.sessionId);
      }
      const rec = started.data;
      // The worker can report or open a gate before agent:start returns.
      // Attach its pane without undoing that progress, and only while this
      // attempt's minted identity still owns the job.
      const attaching = store.getJob(herdId, name);
      if (attaching?.handle === workerId) {
        const attached = store.upsertJob({ ...attaching, pane: rec.paneId ?? null, agentSession: rec.sessionId, agentId: rec.id });
        // An early disposable report had no worker to close yet.
        if (attaching.status === "closed") await closeWorker(herd, attached);
      }

      // Chat identity first: the trust wait can spend its whole budget, and a
      // worker with no handle can neither report nor be reached meanwhile.
      const signIn = await deps.chat["chat:sign-in"]({ sessionId: rec.sessionId, continue: workerId, pane: rec.paneId, cwd: worktree, noRoom: true });
      if (!signIn.ok) log.warn({ herd: herdId, job: name, error: signIn.error }, "herd: worker chat sign-in failed; reports will not deliver until it signs in");
      const handle = signIn.ok ? signIn.data.handle : workerId;
      if (signIn.ok) recordChatSession(log, rec.sessionId, { handle, baseHandle: signIn.data.baseHandle, name: signIn.data.name });
      const joined = await deps.chat["chat:join"]({ room: herd.room, handle, pane: rec.paneId, cwd: worktree });
      if (!joined.ok) log.warn({ herd: herdId, job: name, error: joined.error }, "herd: worker room join failed");
      // Sign-in and join yield too: a report or a replacement spawn may
      // have changed the row while this attempt was joining the room.
      const current = store.getJob(herdId, name);
      const ownsJob = current?.handle === workerId && current.agentId === rec.id && current.agentSession === rec.sessionId;
      if (ownsJob && handle !== workerId) store.upsertJob({ ...current, handle });

      // agent:start drives the dialog for every claude pane it launches
      // (RT-156); a non-claude provider's record carries no outcome at all.
      const trust: TrustOutcome = rec.trust ?? "none";
      // Parked, not just logged: a worker still on the modal has not read its
      // brief, and `spawning` would read as a launch merely in progress.
      // herd-lifecycle clears it back to active the moment herdr detects the
      // agent, so a hand-accepted modal needs no second command.
      if (ownsJob && current.status === "spawning" && trust === "stuck") store.setJobStatus(herdId, name, "stuck-at-modal");
      // No pane means no herdr agent detection to move the job on; its work was submitted, so it is working.
      if (ownsJob && current.status === "spawning" && headless) store.setJobStatus(herdId, name, "active");

      const paneRef = rec.paneId ? formatPaneRef(rec.paneId, herd.hidden ? "bg" : "visible") : "";
      return { ok: true, data: { herd: herdId, job: name, pane: paneRef, worktree, branch, tree, wasOnDeck, agentId: rec.id, sessionId: rec.sessionId, handle, trust } };
    },

    "herd:gates": async (raw: unknown): Promise<CommandResult<"herd:gates">> => {
      const herdId = str((raw as { herd?: unknown } | undefined)?.herd);
      if (!herdId) return { ok: false, error: "herd is required" };
      if (!store.get(herdId)) return { ok: false, error: `unknown herd "${herdId}"` };
      const own = await openHerdGates(herdId);
      const matched = await listHerdRunGates(herdId);
      return { ok: true, data: { gates: [...own, ...matched] } };
    },

    "herd:ask": async (raw: unknown): Promise<CommandResult<"herd:ask">> => {
      const p = raw as Commands["herd:ask"]["payload"] | undefined;
      const fenced = enabled();
      const w = fenced ? workerCall(p) : { herdId: str(p?.herd), name: str(p?.job) };
      const { herdId, name } = w; const session = str(p?.session);
      const unnamed = fenced && (!herdId || !name) ? unattributed(w as WorkerCall, "question") : null;
      if (unnamed) return unnamed;
      if (!herdId || !name || !session) return { ok: false, error: "herd, job, and session are required (HERD_ID, HERD_JOB, CLAUDE_CODE_SESSION_ID)" };
      const herd = store.get(herdId);
      const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      if (fenced) {
        const refused = authorizeWorker(w, herdId, name, job, "question");
        if (refused) return refused;
      }
      if (Array.isArray(p!.questions) && p!.questions.every(isValidQuestion)) {
        const wordy = overlongOptionLabel(p!.questions);
        if (wordy) return { ok: false, error: wordy };
      }
      const paneRef = refPane(str(p?.pane) ?? job.pane ?? undefined, herd.hidden);
      const opened = await openAskedGate(deps.gate, {
        subject: herdSubject(herdId, name), kind: "question", questions: p!.questions,
        meta: { herd: herdId, job: name }, agent: name, pane: paneRef,
        nudge: { session }, context: str(p?.context), origin: herdOrigin(paneRef, session, p!.questions),
      }, session);
      if (!opened.ok) return opened;
      store.setJobStatus(herdId, name, "at-gate", { lastGate: opened.data.id });
      return { ok: true, data: { gate: opened.data.id } };
    },

    "herd:milestone": async (raw: unknown): Promise<CommandResult<"herd:milestone">> => {
      const p = raw as Commands["herd:milestone"]["payload"] | undefined;
      const fenced = enabled();
      const w = fenced ? workerCall(p) : { herdId: str(p?.herd), name: str(p?.job) };
      const { herdId, name } = w; const session = str(p?.session); const artifact = str(p?.artifact);
      const unnamed = fenced && (!herdId || !name) ? unattributed(w as WorkerCall, "milestone") : null;
      if (unnamed) return unnamed;
      if (!herdId || !name || !session || !artifact) return { ok: false, error: "herd, job, session, and artifact are required" };
      const herd = store.get(herdId); const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      if (fenced) {
        const refused = authorizeWorker(w, herdId, name, job, "milestone");
        if (refused) return refused;
      }
      const summary = str(p?.summary) ?? `milestone: ${artifact}`;
      const posted = await deps.chat["chat:post"]({ room: herd.room, handle: job.handle, body: `${summary}\n\nartifact: ${artifact}`, quiet: true });
      if (!posted.ok) return posted;
      const milestonePaneRef = refPane(str(p?.pane) ?? job.pane ?? undefined, herd.hidden);
      const milestoneQuestions: GateQuestion[] = [{ id: "decision", label: summary, multi: false, options: [...MILESTONE_OPTIONS] }];
      const opened = await openAskedGate(deps.gate, {
        subject: herdSubject(herdId, name), kind: "milestone",
        questions: milestoneQuestions,
        meta: { herd: herdId, job: name, artifact, message: posted.data.id },
        agent: name, pane: milestonePaneRef, nudge: { session }, origin: herdOrigin(milestonePaneRef, session, milestoneQuestions),
      }, session);
      if (!opened.ok) return opened;
      store.setJobStatus(herdId, name, "at-milestone", { lastGate: opened.data.id });
      return { ok: true, data: { gate: opened.data.id, message: posted.data.id } };
    },

    "herd:answer": async (raw: unknown): Promise<CommandResult<"herd:answer">> => {
      const p = raw as Commands["herd:answer"]["payload"] | undefined;
      const id = str(p?.gate);
      if (!id) return { ok: false, error: "gate is required" };
      const row = deps.gateStore.get(id);
      if (!row) return { ok: false, error: `gate not found: ${id}` };
      const sessionId = p?.sessionId;
      if (sessionId && row.status === "answered" && row.nudge?.session === sessionId) deps.gateStore.markConsumed(row.id);
      return { ok: true, data: { gate: row.id, status: row.status, answer: row.answer, closedReason: row.closedReason } };
    },

    "herd:report": async (raw: unknown): Promise<CommandResult<"herd:report">> => {
      const p = raw as Commands["herd:report"]["payload"] | undefined;
      const body = str(p?.body);
      const fenced = enabled();
      const w = fenced ? workerCall(p) : { herdId: str(p?.herd), name: str(p?.job) };
      const { herdId, name } = w;
      const unnamed = fenced && (!herdId || !name) ? unattributed(w as WorkerCall, "report") : null;
      if (unnamed) return unnamed;
      if (!herdId || !name || !body) return { ok: false, error: "herd, job, and a non-empty body are required" };
      const herd = store.get(herdId); const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      if (fenced) {
        const refused = authorizeWorker(w, herdId, name, job, "report");
        if (refused) return refused;
      }
      const posted = await deps.chat["chat:post"]({ room: herd.room, handle: job.handle, body, mentions: [herd.shepherdHandle] });
      if (!posted.ok) return posted;
      store.setJobStatus(herdId, name, "done", { lastReport: posted.data.id });
      if (job.disposable) {
        await closeWorker(herd, job);
        store.setJobStatus(herdId, name, "closed");
      }
      return { ok: true, data: { message: posted.data.id } };
    },

    "herd:follow-up": async (raw: unknown): Promise<CommandResult<"herd:follow-up">> => {
      const p = raw as Commands["herd:follow-up"]["payload"] | undefined;
      const herdId = str(p?.herd); const name = str(p?.job);
      if (!herdId || !name) return { ok: false, error: "herd and job are required" };
      const herd = store.get(herdId); const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      if (herd.status !== "active") return { ok: false, error: `herd "${herdId}" is ${herd.status}; a follow-up round needs an active herd` };
      if (job.status !== "done") return { ok: false, error: `job "${name}" is ${job.status}, not done; only a job that has reported can start a follow-up round` };
      if (!job.pane) return { ok: false, error: `job "${name}" has no pane; a follow-up round runs in the worker's own pane` };
      // Back to active rather than a status of its own: the lifecycle and the
      // watchdog already judge an active job as a live worker, so the done
      // nag stops and the worker backstop becomes the round's quiet limit.
      // setJobStatus leaves lastReport alone; the next report replaces it.
      store.setJobStatus(herdId, name, "active");
      return { ok: true, data: { job: name, status: "active" } };
    },

    "herd:attend": async (raw: unknown): Promise<CommandResult<"herd:attend">> => {
      const p = raw as Commands["herd:attend"]["payload"] | undefined;
      const herdId = str(p?.herd); const name = str(p?.job); const callerWorkspace = str(p?.callerWorkspace);
      if (!herdId || !name || !callerWorkspace) return { ok: false, error: "herd, job, and callerWorkspace (HERDR_WORKSPACE_ID) are required" };
      const herd = store.get(herdId); const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      if (!herd.hidden || !herd.herdrSocket) return { ok: false, error: "herd is not hidden; focus the pane directly" };
      if (!job.pane) return { ok: false, error: `job "${name}" has no pane` };
      const res = await attendPane({
        socket: herd.herdrSocket, paneId: parsePaneRef(job.pane).paneId, session: BG_SESSION, label: `attend: ${name}`,
        callerWorkspace, herdrRunnerFor: deps.herdrRunnerFor,
      });
      if (!res.ok) return res;
      // Round-trip rule: attend only ever runs for a hidden herd (guarded
      // above), so this is always a bg: ref -- formatted explicitly rather
      // than assumed, so the field stays honest if that guard ever loosens.
      return { ok: true, data: { tab: res.tab, pane: formatPaneRef(res.pane, herd.hidden ? "bg" : "visible") } };
    },

    "herd:stop-hidden": async (_payload: unknown): Promise<CommandResult<"herd:stop-hidden">> => {
      const live = deps.claims.list();
      if (live.length > 0) return { ok: false, error: `bg server has live claims: ${live.map((c) => c.owner).join(", ")}; wrap them up first` };
      try {
        await deps.bg.stop();
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { ok: true, data: { stopped: true } };
    },

    "herd:wrap-up": async (raw: unknown): Promise<CommandResult<"herd:wrap-up">> => {
      const p = raw as Commands["herd:wrap-up"]["payload"] | undefined;
      const herdId = str(p?.herd);
      if (!herdId) return { ok: false, error: "herd is required" };
      const herd = store.get(herdId);
      if (!herd) return { ok: false, error: `unknown herd "${herdId}"` };
      const jobs = store.jobs(herdId);
      const runner = deps.herdrRunnerFor(herd.herdrSocket);
      const closed: string[] = [];
      let workspaceClosed = false;

      if (p?.closePanes === true) {
        const attempted: string[] = [];
        for (const job of jobs) {
          if (job.status !== "closed" && hasWorker(herdId, job)) {
            attempted.push(job.name);
            if (await closeWorker(herd, job)) {
              closed.push(job.name);
              store.setJobStatus(herdId, job.name, "closed");
            }
            continue;
          }
          store.setJobStatus(herdId, job.name, "closed");
        }
        try {
          const list = await runner(["workspace", "list"]);
          const ws = (JSON.parse(list.stdout)?.result?.workspaces ?? []).find((w: any) => w?.label === herd.workspace);
          if (ws?.workspace_id) { await runner(["workspace", "close", ws.workspace_id]); workspaceClosed = true; }
        } catch (err) {
          log.warn({ herd: herdId, err }, "herd wrap-up: workspace close failed");
        }
        // Released only when every pane that was actually attempted really
        // closed -- closePane is best-effort, and a job only flips to
        // "closed" above when its close actually succeeded, so a retried
        // wrap-up still sees a failed job as pane-bearing and re-attempts it.
        // A partial/total failure keeps the claim; herd-lifecycle.ts's
        // sweepClaims herd pass is the eventual releaser once the panes
        // actually die (crash, a later manual close, ...).
        if (herd.hidden) {
          const failed = attempted.filter((name) => !closed.includes(name));
          if (failed.length === 0) {
            deps.claims.release(herdOwner(herdId));
          } else {
            log.warn({ herd: herdId, failed }, "herd wrap-up: some pane closes failed; bg claim kept");
          }
        }
      }

      const disposed: string[] = []; const refused: Array<{ tree: string; reason: string }> = [];
      for (const name of Array.isArray(p?.dispose) ? p!.dispose! : []) {
        const job = jobs.find((j) => j.name === name);
        if (!job || !job.tree) { refused.push({ tree: name, reason: "no rt-provisioned tree for this job" }); continue; }
        const r = await deps.worktree["worktree:dispose"]({ repoName: herd.repo, tree: job.tree });
        if (!r.ok) { refused.push({ tree: job.tree, reason: r.error }); continue; }
        disposed.push(...(r.data.disposed as string[]));
        refused.push(...(r.data.refused as Array<{ tree: string; reason: string }>));
      }

      let deletedJobDirs = false;
      if (p?.deleteJobDirs === true) { rmSync(join(deps.jobsRoot, herdId), { recursive: true, force: true }); deletedJobDirs = true; }

      let archived = false;
      if (p?.archiveRoom === true) {
        const r = await deps.chat["chat:archive"]({ room: herd.room, handle: herd.shepherdHandle, archived: true });
        if (r.ok) archived = true; else log.warn({ herd: herdId, error: r.error }, "herd wrap-up: archive failed");
      }

      store.setHerdStatus(herdId, "wrapped");
      return { ok: true, data: { closed, workspaceClosed, disposed, refused, deletedJobDirs, archived } };
    },
  };
}
