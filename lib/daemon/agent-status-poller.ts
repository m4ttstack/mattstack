/**
 * Mirrors herdr agent statuses onto runs, live. The runs payload carries the
 * attributed agent's status (store.ts `agentMirror`), but nothing would tell
 * a console tab the status FLIPPED — herdr transitions write no run event.
 * This poller probes herdr, diffs each running run's attributed status
 * against the last tick, and emits `run-updated` on change, so blocked→red
 * appears (and clears) at probe cadence instead of at the next slow poll.
 *
 * herdr stays optional: a failed probe (null) skips the tick entirely,
 * holding last-known state — a herdr restart must not flap every run's
 * status to null and back. A successful empty answer diffs normally.
 */
import type { RunSummary } from "../../packages/rt-client/src/commands.ts";
import type { Database } from "bun:sqlite";
import { builtinRegistry } from "../agent-integrations/builtins.ts";
import { integrationsEnabled } from "../agent-integrations/context.ts";
import type { IntegrationRegistry } from "../agent-integrations/contracts.ts";
import { listAttachedBindings } from "../agent-integrations/session-store.ts";
import { livenessFrom, primeLivenessCache, probeAgents, type AgentEntry } from "../runs/liveness.ts";
import type { RunLiveness } from "../runs/attention.ts";
import { listRuns } from "../runs/store.ts";
import { getStateDb } from "../state/db.ts";

const POLL_MS = 10_000;
const FAILURE_THRESHOLD = 3;   // consecutive null probes before backing off
const BACKOFF_TICKS = 6;       // then probe once every 6 ticks (~60s at 10s cadence)

interface Log {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface AgentStatusPollerHandle {
  stop(): void;
  /** Test seam: run one tick now. */
  tick(): Promise<void>;
}

/**
 * With agent.integrations.enabled on, each harness's session adapter observes
 * its attached bindings, which is where a Claude session that left its
 * attachment is detached. Off, nothing is read.
 */
export async function observeBoundSessions(deps: {
  enabled?: () => boolean;
  db?: () => Database;
  integrations?: () => IntegrationRegistry;
} = {}): Promise<void> {
  if (!(deps.enabled ?? integrationsEnabled)()) return;
  const db = (deps.db ?? getStateDb)();
  for (const integration of (deps.integrations ?? builtinRegistry)().list()) {
    if (!integration.loadSessions) continue;
    const bindings = listAttachedBindings(db, integration.id);
    if (bindings.length === 0) continue;
    const sessions = await integration.loadSessions();
    for (const binding of bindings) await sessions.observe(binding);
  }
}

export function startAgentStatusPoller(opts: {
  emitEvent: (topic: string, payload: unknown) => void;
  log: Log;
  intervalMs?: number;
  probe?: () => Promise<AgentEntry[] | null>;
  list?: (liveness: RunLiveness) => RunSummary[];
  observeSessions?: () => Promise<void>;
}): AgentStatusPollerHandle {
  const probe = opts.probe ?? (() => probeAgents());
  const list = opts.list ?? ((liveness: RunLiveness) => listRuns(undefined, liveness));
  const observeSessions = opts.observeSessions ?? (() => observeBoundSessions());
  const last = new Map<string, string | null>();
  let seeded = false;
  let consecutiveFailures = 0;
  let ticksSkipped = 0;

  const tick = async (): Promise<void> => {
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      if (++ticksSkipped < BACKOFF_TICKS) return;
      ticksSkipped = 0;
    }
    const entries = await probe();
    if (entries === null) { consecutiveFailures++; return; }
    consecutiveFailures = 0;
    primeLivenessCache(entries);
    let runs: RunSummary[];
    try {
      runs = list(livenessFrom(entries));
    } catch (err) {
      opts.log.warn({ err }, "agent-status poller could not list runs");
      return;
    }
    const seen = new Set<string>();
    for (const run of runs) {
      if (run.status !== "running") continue;
      const key = `${run.repo}/${run.id}`;
      seen.add(key);
      const status = run.agent?.status ?? null;
      // The first tick seeds silently: daemon boot is not a status change.
      if (seeded && last.has(key) && last.get(key) !== status) {
        opts.emitEvent("run-updated", { repo: run.repo, runId: run.id, stage: null, kind: "agent-status" });
      }
      last.set(key, status);
    }
    for (const key of last.keys()) if (!seen.has(key)) last.delete(key);
    seeded = true;
    try {
      await observeSessions();
    } catch (err) {
      opts.log.warn({ err }, "agent-status poller could not observe agent sessions");
    }
  };

  const timer = setInterval(() => void tick().catch(() => {}), opts.intervalMs ?? POLL_MS);
  return {
    tick,
    stop() {
      clearInterval(timer);
    },
  };
}
