/**
 * The herd watchdog's sensors and actuators over the daemon's real stores,
 * herdr, chat, and the notifier queue. Every dependency arrives as an object
 * so a test (or the e2e harness) can stand in fakes for herdr, gates, chat,
 * and the injector without touching the ladder.
 */
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import type { HarnessId, Observation, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { formatPaneRef, parsePaneRef, type PaneServer } from "../../packages/rt-client/src/index.ts";
import { builtinRegistry, UNRECORDED_PANE_HARNESS } from "../agent-integrations/builtins.ts";
import { installedModLinks, pushModCommand, type ModLinks } from "../agent-integrations/claude/mod-links.ts";
import { modPath } from "../agent-integrations/claude/mod-path.ts";
import { createObservationSweep, type IntegrationRegistry, type ObservationSweep } from "../agent-integrations/contracts.ts";
import { latestObservation, pushedDeath, recordObservation } from "../agent-integrations/observation-store.ts";
import { createSessionStore } from "../agent-integrations/session-store.ts";
import { integrationsEnabled } from "../agent-integrations/switch.ts";
import type { herdrRequest } from "../herdr/client.ts";
import { peekUnread } from "../state/chat-store.ts";
import { dmParticipants } from "../state/dm-store.ts";
import { enqueueNotification } from "../state/notifier-store.ts";
import type { GatesStore } from "./gates-store.ts";
import type { HerdLifecycle } from "./herd-lifecycle.ts";
import { currentJobAttempt, type HerdJobRow, type HerdStore, type JobAttempt } from "./herd-store.ts";
import {
  classifyJobObservation, STALE_OBSERVATION_MS,
  type ObservedJob, type WatchdogActuators, type WatchdogConfig, type WatchdogSensors,
} from "./herd-watchdog.ts";
import { injectIntoPane } from "./inject.ts";
import { cwdPath, driveRelocationAccept, driveTrustAccept } from "./trust-accept.ts";
import { paneStatuses } from "./pane-statuses.ts";
import { findTreeByPath } from "../worktree/registry.ts";

export type ObserveJob = (attempt: JobAttempt) => Promise<Outcome<Observation>>;

/**
 * A job attempt's worker as its own harness integration observes it: the
 * newest shared observation of its binding while that is still fresh and of
 * the binding's current generation, else a new observation, recorded for the
 * next reader. An unbound attempt has none; its pane is supervised instead.
 */
export function createJobObserver(deps: {
  db: () => Database;
  integrations?: IntegrationRegistry;
  now?: () => number;
  /** Shared by every observe of one pass. */
  sweep?: ObservationSweep;
}): { observeJob: ObserveJob } {
  const now = deps.now ?? Date.now;
  const registry = deps.integrations ?? builtinRegistry();
  const fail = (code: "unsupported" | "invalid", message: string): Outcome<Observation> => ({ ok: false, error: { code, message } });
  return {
    async observeJob(attempt) {
      if (attempt.bindingKey === undefined) return fail("unsupported", `attempt ${attempt.id} has no session binding to observe`);
      const binding = createSessionStore(deps.db()).get(attempt.bindingKey);
      if (!binding) return fail("invalid", `no session binding has key ${attempt.bindingKey}`);
      // Only session:end pushes a death, and its sign-out moves the binding past the attempt's generation.
      const death = pushedDeath(binding.key, attempt.generation);
      if (death && now() - death.observedAt <= STALE_OBSERVATION_MS) return { ok: true, data: death };
      const held = latestObservation(binding.key);
      if (held && held.generation === binding.attachment.generation && now() - held.observedAt <= STALE_OBSERVATION_MS) return { ok: true, data: held };
      const sessions = await registry.get(binding.native.harness)?.loadSessions?.();
      if (!sessions) return fail("unsupported", `${binding.native.harness} sessions cannot be observed`);
      const seen = await sessions.observe(binding, deps.sweep);
      if (seen.ok) recordObservation(binding.key, seen.data);
      return seen;
    },
  };
}

export interface WatchdogSensorDeps {
  /** `activeAttempt` and `attempts` name each job's harness and binding; without them every pane reads as the unrecorded harness's. */
  herdStore: Pick<HerdStore, "list" | "jobs"> & Partial<Pick<HerdStore, "activeAttempt" | "attempts">>;
  gatesStore: Pick<GatesStore, "list" | "unconsumedAnsweredPushes">;
  lifecycle: Pick<HerdLifecycle, "lastStatusChangeMs">;
  herdr: typeof herdrRequest;
  defaultSocket: string;
  db: Database;
  now?: () => number;
  /** Used only to report a herdr status this mapper does not name. */
  log?: Logger;
  /** agent.integrations.enabled; off, every job is supervised by its pane. */
  enabled?: () => boolean;
  /** The harnesses whose pane screens name background work. */
  integrations?: IntegrationRegistry;
  /** Observes a bound attempt's worker; the shared observation store and the job's own integration when omitted. */
  observeJob?: ObserveJob;
  /** The daemon's live mod links, which say whose mod takes nudges; the installed registry when omitted. */
  modLinks?: () => ModLinks | null;
}

export interface RefreshingSensors extends WatchdogSensors {
  /** Snapshots every herdr server the active herds live on, once; the pane
      readings below answer from that snapshot until the next call. */
  refresh(): Promise<void>;
  /** The socket the pane was last seen on; the default socket for a pane no
      snapshot listed (a shepherd pane always sits there). */
  socketFor(pane: string): string;
}

interface PaneReading { agent: string | null; status: string | null; socket: string }

const jobKey = (job: Pick<HerdJobRow, "herd" | "name">): string => `${job.herd}/${job.name}`;

const UNREAD_PEEK_LIMIT = 200;

/** The statuses this mapper names. Anything else a live agent reports still
    maps, to idle: board-37 sat wedged for 31 minutes because "done" fell
    through to working, and a working pane is never poked. A status nobody
    mapped must never exempt a pane again, so the fall-through is idle and the
    gap is logged rather than swallowed. */
const NAMED_STATUSES: ReadonlySet<string> = new Set(["working", "idle", "blocked", "done"]);

/** herdr names a pane's agent by its harness id, so a pane listed with any other agent, or none, has lost its worker. */
function readingState(row: PaneReading | undefined, harness: HarnessId, unknown?: (status: string) => void): ReturnType<WatchdogSensors["paneState"]> {
  if (!row) return "gone";
  if (row.agent !== harness) return "dead";
  if (row.status === "blocked") return "modal";
  if (row.status === "working") return "working";
  // No status at all is not an unnamed status: herdr has not classified the
  // pane yet, which is evidence of nothing either way.
  if (row.status === null) return "working";
  // "done" is herdr's after-turn state: a finished turn sitting at the prompt
  // is exactly the wedge posture the fast path is looking for.
  if (!NAMED_STATUSES.has(row.status)) unknown?.(row.status);
  return "idle";
}

type Tracked = { attempt: string; state: ObservedJob["state"]; since: number; backgroundSince: number | null };

/** An observed worker's state in the evaluators' terms; blocked is a modal only on a pane rt may type into. */
function observedState(classified: ReturnType<typeof classifyJobObservation>, observation: Observation | null, typesIntoPane: boolean): ObservedJob["state"] {
  switch (classified) {
    case "dead": return "dead";
    case "unknown": return "unknown";
    case "blocked": return typesIntoPane ? "modal" : "blocked";
    case "active": return observation?.execution === "idle" ? "idle" : "working";
  }
}

export function createWatchdogSensors(deps: WatchdogSensorDeps): RefreshingSensors {
  const now = deps.now ?? Date.now;
  const enabled = deps.enabled ?? integrationsEnabled;
  const registry = deps.integrations ?? builtinRegistry();
  // The harness each job pane runs, from the job's attempts; any other pane (a shepherd's, a job with no attempt) reads as the unrecorded one.
  let paneHarness = new Map<string, HarnessId>();
  const harnessOf = (pane: string): HarnessId => paneHarness.get(pane) ?? UNRECORDED_PANE_HARNESS;
  let observed = new Map<string, ObservedJob>();
  let tracked = new Map<string, Tracked>();
  // Keyed by the addressable ref the job row stores (bg: for a hidden herd),
  // not the bare id: two servers can both hold a w1:p1.
  let panes = new Map<string, PaneReading>();
  // The lifecycle's status map is in memory, so after a daemon restart every
  // worker that was already idle has no recorded transition and would read as
  // "never idle" forever (RT-187). The first refresh that sees such a pane
  // idle stamps it here, and that stamp stands in for the transition until the
  // pane works again: an age measured from the restart, never from boot-time
  // zero, so a worker idle across a restart still earns a verdict.
  const firstSeenIdle = new Map<string, number>();
  let busy = new Map<string, { task: string; sinceMs: number }>();

  async function refresh(): Promise<void> {
    const active = deps.herdStore.list({ status: "active" });
    const servers = new Map<string, PaneServer>(active.length > 0 ? [[deps.defaultSocket, "visible"]] : []);
    for (const herd of active) {
      if (herd.herdrSocket && !servers.has(herd.herdrSocket)) servers.set(herd.herdrSocket, herd.hidden ? "bg" : "visible");
    }
    const next = new Map<string, PaneReading>();
    for (const [socket, server] of servers) {
      for (const [id, row] of await paneStatuses(deps.herdr, socket)) next.set(formatPaneRef(id, server), { ...row, socket });
    }
    const t = now();
    const switchOn = enabled();
    const nextHarness = new Map<string, HarnessId>();
    const boundJobs: Array<{ job: HerdJobRow; attempt: JobAttempt }> = [];
    for (const herd of active) {
      for (const job of deps.herdStore.jobs(herd.id)) {
        if (job.status === "closed") continue;
        const attempt = currentJobAttempt(deps.herdStore, herd.id, job.name);
        if (job.pane !== null && attempt) nextHarness.set(job.pane, attempt.selection.harness);
        if (switchOn && attempt?.state === "active" && attempt.bindingKey !== undefined) boundJobs.push({ job, attempt });
      }
    }
    paneHarness = nextHarness;
    for (const pane of firstSeenIdle.keys()) if (readingState(next.get(pane), harnessOf(pane)) !== "idle") firstSeenIdle.delete(pane);
    // One warn per unrecognized status per sweep, not per pane: a herdr that
    // grew a new status would otherwise warn once for every worker it runs.
    const unnamed = new Set<string>();
    for (const [pane, row] of next) {
      if (readingState(row, harnessOf(pane), (status) => unnamed.add(status)) !== "idle" || deps.lifecycle.lastStatusChangeMs(pane) !== null) continue;
      if (!firstSeenIdle.has(pane)) firstSeenIdle.set(pane, t);
    }
    for (const status of unnamed) deps.log?.warn({ status }, "watchdog: unrecognized herdr agent status; treating the pane as idle");
    panes = next;
    observed = await observeBound(boundJobs, next, t);
    const nextBusy = new Map<string, { task: string; sinceMs: number }>();
    for (const herd of active) {
      for (const job of deps.herdStore.jobs(herd.id)) {
        if (job.pane === null || job.status === "closed" || observed.has(jobKey(job))) continue;
        const readsBackground = registry.get(harnessOf(job.pane))?.paneBackground;
        const row = next.get(job.pane);
        if (!readsBackground || !row || readingState(row, harnessOf(job.pane)) !== "idle") continue;
        const screen = await deps.herdr<{ read?: { text?: unknown } }>("pane.read", { pane_id: parsePaneRef(job.pane).paneId, source: "visible" }, { sockPath: row.socket });
        // An ok reply's body is still herdr's to get wrong. A read that yields
        // no text screen is no evidence either way, so the previous entry and
        // its stamp carry over: a flaky read must not restart the cap's clock.
        const text = screen.ok ? screen.result?.read?.text : undefined;
        const previous = busy.get(job.pane);
        if (typeof text !== "string") {
          if (previous) nextBusy.set(job.pane, previous);
          continue;
        }
        const task = readsBackground(text);
        if (task !== null) nextBusy.set(job.pane, { task, sinceMs: previous?.sinceMs ?? t });
      }
    }
    busy = nextBusy;
  }

  /**
   * Each bound job's observation, classified against its own attempt. A
   * failed or throwing observe is unknown. The idle clock of a job with a
   * pane is the pane's own, as for every pane; otherwise each state is
   * timed from the first refresh that saw it.
   */
  async function observeBound(jobs: Array<{ job: HerdJobRow; attempt: JobAttempt }>, rows: Map<string, PaneReading>, t: number): Promise<Map<string, ObservedJob>> {
    const observe = deps.observeJob ?? createJobObserver({ db: () => deps.db, integrations: registry, now, sweep: createObservationSweep() }).observeJob;
    const links = (deps.modLinks ?? installedModLinks)();
    const sessions = links ? createSessionStore(deps.db) : null;
    const out = new Map<string, ObservedJob>();
    const nextTracked = new Map<string, Tracked>();
    for (const { job, attempt } of jobs) {
      let observation: Observation | null = null;
      try {
        const seen = await observe(attempt);
        if (seen.ok) observation = seen.data;
      } catch (err) {
        deps.log?.warn({ err, herd: job.herd, job: job.name }, "watchdog: could not observe a bound worker");
      }
      const typesIntoPane = job.pane !== null && registry.get(attempt.selection.harness)?.typedPaneInput === true;
      const classified = observation ? classifyJobObservation(attempt, observation, t) : "unknown";
      const state = observedState(classified, observation, typesIntoPane);
      const key = jobKey(job);
      const previous = tracked.get(key);
      const same = previous?.attempt === attempt.id;
      const since = same && previous.state === state ? previous.since : t;
      const backgroundOn = classified === "active" && observation?.background === "active";
      const backgroundSince = backgroundOn ? (same && previous.backgroundSince !== null ? previous.backgroundSince : t) : null;
      nextTracked.set(key, { attempt: attempt.id, state, since, backgroundSince });
      const paneClock = job.pane !== null && (state === "idle" || state === "modal") && rows.has(job.pane)
        ? deps.lifecycle.lastStatusChangeMs(job.pane) ?? firstSeenIdle.get(job.pane) ?? null
        : null;
      const binding = attempt.bindingKey === undefined ? null : sessions?.get(attempt.bindingKey) ?? null;
      const modSession = binding && modPath(binding, "observe", links) ? binding.native.value : undefined;
      out.set(key, {
        state, typesIntoPane,
        since: paneClock ?? since,
        background: backgroundSince === null ? null : { task: "work", sinceMs: backgroundSince },
        ...(modSession !== undefined && { modSession }),
      });
    }
    tracked = nextTracked;
    return out;
  }

  return {
    refresh,
    socketFor: (pane) => panes.get(pane)?.socket ?? deps.defaultSocket,
    now,
    herds: () => deps.herdStore.list({ status: "active" }),
    jobs: (herd) => deps.herdStore.jobs(herd),
    observedJob: (job) => observed.get(jobKey(job)) ?? null,
    typesIntoPane: (pane) => registry.get(harnessOf(pane))?.typedPaneInput === true,
    paneState: (pane) => readingState(panes.get(pane), harnessOf(pane)),
    idleSinceMs: (pane) => deps.lifecycle.lastStatusChangeMs(pane) ?? firstSeenIdle.get(pane) ?? null,
    backgroundWork: (pane) => busy.get(pane) ?? null,
    unreadDmMentionsFor(handle) {
      let count = 0;
      for (const { room, messages } of peekUnread({ handle, limit: UNREAD_PEEK_LIMIT }, deps.db)) {
        const dm = dmParticipants(room, deps.db) !== null;
        for (const m of messages) if (m.handle !== handle && (dm || m.mentions.includes(handle))) count += 1;
      }
      return count;
    },
    openHumanGates(prefix) {
      const t = now();
      return deps.gatesStore.list({ open: true, subjectPrefix: prefix }).gates
        .filter((g) => g.owner === "human")
        .map((g) => ({ id: g.id, ageMs: t - g.openedAt }));
    },
    unconsumedAnswered(session) {
      const t = now();
      return deps.gatesStore.unconsumedAnsweredPushes(t)
        .filter((g) => g.nudge?.session === session)
        .map((g) => ({ id: g.id, ageMs: t - (g.answer?.answeredAt ?? t) }));
    },
  };
}

export interface WatchdogActuatorDeps {
  herdStore: Pick<HerdStore, "setJobStatus">;
  db: Database;
  socketFor: (pane: string) => string;
  /** Needed only by the mid-run trust accept; the other actuators go through
      the injector. */
  herdr?: typeof herdrRequest;
  inject?: typeof injectIntoPane;
  enqueue?: typeof enqueueNotification;
  log: Logger;
  trustSettleMs?: number;
  trustStepMs?: number;
  /** Pushes a command to a Claude session's mod and waits for its ack; pushModCommand when omitted. */
  push?: (session: string, kind: string, data: unknown) => Promise<Outcome<{ acked: boolean }>>;
}

/** None of these throw into the ladder: one party's failed side effect must
    not end the sweep for every other herd. */
export function createWatchdogActuators(deps: WatchdogActuatorDeps): WatchdogActuators {
  const inject = deps.inject ?? injectIntoPane;
  const enqueue = deps.enqueue ?? enqueueNotification;
  const { log } = deps;
  return {
    async poke(pane, text) {
      const sockPath = deps.socketFor(pane);
      try {
        const res = await inject({ paneId: parsePaneRef(pane).paneId, text, sockPath });
        if (!res.ok) {
          log.warn({ pane, sockPath, error: res.error }, "watchdog poke failed");
          return false;
        }
        if (res.data.delivered !== "accepted") {
          log.info({ pane, sockPath, delivered: res.data.delivered, reason: res.data.reason }, "watchdog poke not accepted");
          return false;
        }
        return true;
      } catch (err) {
        log.warn({ err, pane, sockPath }, "watchdog poke threw");
        return false;
      }
    },
    async acceptTrustModal(herd, job, pane, worktreePath) {
      if (!deps.herdr) return false;
      // Fail closed on a job with no worktree path recorded: never fall back
      // to the registry, which would admit any tree rt tracks, not just this
      // job's own.
      if (!worktreePath) return false;
      const sockPath = deps.socketFor(pane);
      try {
        const outcome = await driveTrustAccept({
          herdr: deps.herdr, sock: { sockPath }, pane: parsePaneRef(pane).paneId,
          log, context: { herd, job },
          trustsPath: cwdPath(worktreePath),
          ...(deps.trustSettleMs !== undefined && { settleMs: deps.trustSettleMs }),
          ...(deps.trustStepMs !== undefined && { stepMs: deps.trustStepMs }),
        });
        if (outcome !== "accepted") log.info({ herd, job, pane, outcome }, "watchdog: mid-run trust accept did not clear the pane");
        return outcome === "accepted";
      } catch (err) {
        log.warn({ err, herd, job, pane }, "watchdog: mid-run trust accept threw");
        return false;
      }
    },
    async acceptRelocationModal(herd, job, pane) {
      if (!deps.herdr) return false;
      const sockPath = deps.socketFor(pane);
      try {
        const outcome = await driveRelocationAccept({
          herdr: deps.herdr, sock: { sockPath }, pane: parsePaneRef(pane).paneId,
          log, context: { herd, job },
          isRegisteredTree: (path) => findTreeByPath(path) !== null,
          ...(deps.trustSettleMs !== undefined && { settleMs: deps.trustSettleMs }),
          ...(deps.trustStepMs !== undefined && { stepMs: deps.trustStepMs }),
        });
        if (outcome !== "accepted" && outcome !== "no-dialog") log.info({ herd, job, pane, outcome }, "watchdog: relocation accept did not clear the pane");
        return outcome === "accepted";
      } catch (err) {
        log.warn({ err, herd, job, pane }, "watchdog: relocation accept threw");
        return false;
      }
    },
    parkStuckAtModal(herd, job) {
      try {
        deps.herdStore.setJobStatus(herd, job, "stuck-at-modal");
      } catch (err) {
        log.warn({ err, herd, job }, "watchdog could not park the job");
      }
    },
    notifyStuckAtModal(herd, job, pane) {
      try {
        enqueue({
          id: crypto.randomUUID(),
          title: `herd ${herd}: ${job} stuck at trust modal`,
          message: `click to focus pane ${pane}, accept the dialog`,
          category: "herd-watchdog",
          timestamp: Date.now(),
          paneId: pane,
        }, deps.db);
      } catch (err) {
        log.warn({ err, herd, job, pane }, "watchdog could not enqueue the park notification");
      }
    },
    notifyHuman(summary, pane) {
      try {
        enqueue({
          id: crypto.randomUUID(), title: "herd watchdog", message: summary,
          category: "herd-watchdog", timestamp: Date.now(),
          ...(pane ? { paneId: pane } : {}),
        }, deps.db);
      } catch (err) {
        log.warn({ err, summary }, "watchdog could not enqueue the notification");
      }
    },
    async nudge(session, text) {
      try {
        const pushed = await (deps.push ?? pushModCommand)(session, "nudge", { text });
        if (!pushed.ok) log.info({ session, error: pushed.error }, "watchdog nudge could not reach the mod");
        return pushed.ok && pushed.data.acked;
      } catch (err) {
        log.warn({ err, session }, "watchdog nudge threw");
        return false;
      }
    },
  };
}

const CONFIG_DEFAULTS: WatchdogConfig = {
  enabled: true, fastMins: 2, shepherdFastMins: 5, backstopMins: 15,
  retryMins: 5, notifyQuietMins: 30, nagMins: 30, notifyHuman: true,
  midRunTrustAccept: false, relocationAutoAccept: true,
  backgroundCapMins: 60,
};

/** Resolves the nine `herd.watchdog.*` keys through `read` (the settings
    resolver's getSetting), one at a time so a single unreadable or mistyped
    key falls back alone. Meant to run on every sweep, never cached. */
export function readWatchdogConfig(read: <T>(key: string) => { value: T }): WatchdogConfig {
  const bool = (name: "enabled" | "notifyHuman" | "midRunTrustAccept"): boolean => {
    try {
      const v = read<unknown>(`herd.watchdog.${name}`).value;
      return typeof v === "boolean" ? v : CONFIG_DEFAULTS[name];
    } catch {
      return CONFIG_DEFAULTS[name];
    }
  };
  // retryMins and notifyQuietMins gate a repeat action (a poke, a
  // notification); 0 on both turns the sweep interval into the repeat
  // interval, so they floor at 1. The other minute keys stay at 0 because
  // fastMins: 0 is a valid "poke immediately" setting the e2e relies on.
  const FLOORED: ReadonlySet<string> = new Set(["retryMins", "notifyQuietMins"]);
  const mins = (name: "fastMins" | "shepherdFastMins" | "backstopMins" | "retryMins" | "notifyQuietMins" | "nagMins"): number => {
    try {
      const v = read<unknown>(`herd.watchdog.${name}`).value;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return CONFIG_DEFAULTS[name];
      return FLOORED.has(name) ? Math.max(1, v) : v;
    } catch {
      return CONFIG_DEFAULTS[name];
    }
  };
  // Not a herd.watchdog.* key: the reconciler's blocked-pane path reads the
  // same switch, so it lives in the pane family and both seams resolve it.
  const relocationAutoAccept = (() => {
    try {
      const v = read<unknown>("panes.relocationAutoAccept").value;
      return typeof v === "boolean" ? v : CONFIG_DEFAULTS.relocationAutoAccept;
    } catch {
      return CONFIG_DEFAULTS.relocationAutoAccept;
    }
  })();
  return {
    enabled: bool("enabled"),
    fastMins: mins("fastMins"),
    shepherdFastMins: mins("shepherdFastMins"),
    backstopMins: mins("backstopMins"),
    retryMins: mins("retryMins"),
    notifyQuietMins: mins("notifyQuietMins"),
    nagMins: mins("nagMins"),
    notifyHuman: bool("notifyHuman"),
    midRunTrustAccept: bool("midRunTrustAccept"),
    relocationAutoAccept,
    backgroundCapMins: CONFIG_DEFAULTS.backgroundCapMins,
  };
}
