import type { RunSummary } from '@mattstack/rt-client';
import type { ActiveRun } from './client/types.ts';
import type { BoardMR } from './data.ts';
import { normalizeMrUrl } from './gates/run-mr.ts';
import { firstOwnerAlong, ownerSteps, type SessionProbe } from './run-owner.ts';
import type { OwnMrFacts } from './triage/edge.ts';
import {
  liveHandoffs,
  type DispatchMemory,
  type Handoff,
  type HandoffKind,
} from './triage/memory.ts';
import { numericPipelineId } from './triage/run.ts';

export const RUN_OWNER_TTL_MS = 10_000;

export interface RunOwnerRefresher {
  /** Kick a background refresh if the last one is older than ttlMs; never awaits. */
  poke(): void;
  /** Last known live owner per MR url (own run first, else nearest ancestor's). */
  ownerFor(mrUrl: string): ActiveRun | undefined;
  /** Resolves once the refresh in flight, if any, has landed. */
  settled(): Promise<void>;
}

export interface RunOwnerRefresherIo {
  /** null = the lookup failed. */
  listRuns(): Promise<RunSummary[] | null>;
  probe: SessionProbe;
  mrs(): OwnMrFacts[];
  repoSlugForMr(mrUrl: string): string;
  now(): number;
  /** Fires when a refresh changes any MR's owner. */
  onChange?(): void;
}

/** Past this many failed run lookups in a row, the last known owners go too,
    so a long outage behaves as if no run were active. */
export const RUN_OWNER_MAX_FAILURES = 3;

function ownersKey(owners: Map<string, ActiveRun>): string {
  return JSON.stringify([...owners].sort(([a], [b]) => a.localeCompare(b)));
}

/** Which live work run owns each board MR, kept fresh in the background so
    the snapshot never waits on the daemon. A failed run lookup keeps the
    last known owners until RUN_OWNER_MAX_FAILURES in a row. */
export function createRunOwnerRefresher(
  io: RunOwnerRefresherIo,
  ttlMs: number = RUN_OWNER_TTL_MS
): RunOwnerRefresher {
  let owners = new Map<string, ActiveRun>();
  let failures = 0;
  let startedAt: number | null = null;
  let inflight: Promise<void> | null = null;

  function publish(next: Map<string, ActiveRun>): void {
    const changed = ownersKey(next) !== ownersKey(owners);
    owners = next;
    if (changed) io.onChange?.();
  }

  async function refresh(): Promise<void> {
    let runs: RunSummary[] | null;
    try {
      runs = await io.listRuns();
    } catch {
      runs = null;
    }
    if (runs === null) {
      failures++;
      if (failures >= RUN_OWNER_MAX_FAILURES) publish(new Map());
      return;
    }
    failures = 0;
    const probes = new Map<string, ReturnType<SessionProbe>>();
    const probe: SessionProbe = session => {
      let p = probes.get(session);
      if (!p) {
        p = io.probe(session).catch(() => ({ reachable: false }));
        probes.set(session, p);
      }
      return p;
    };
    const mrs = io.mrs();
    const next = new Map<string, ActiveRun>();
    for (const mr of mrs) {
      const found = await firstOwnerAlong(
        ownerSteps(mrs, mr.mrUrl, io.repoSlugForMr),
        runs,
        probe
      );
      if (!found) continue;
      const { owner, step } = found;
      next.set(normalizeMrUrl(mr.mrUrl), {
        runId: owner.runId,
        stage: owner.stage,
        ...(owner.name !== undefined ? { name: owner.name } : {}),
        ...(step.viaIid !== undefined ? { viaIid: step.viaIid } : {}),
        ...(!step.own && step.viaMr === null
          ? { viaBranch: step.query.branch }
          : {}),
      });
    }
    publish(next);
  }

  return {
    poke() {
      if (inflight) return;
      const now = io.now();
      if (startedAt !== null && now - startedAt < ttlMs) return;
      startedAt = now;
      inflight = refresh()
        .catch(() => {})
        .finally(() => {
          inflight = null;
        });
    },
    ownerFor(mrUrl) {
      return owners.get(normalizeMrUrl(mrUrl));
    },
    async settled() {
      await inflight;
    },
  };
}

export function attachActiveRuns<T extends { webUrl?: string | null }>(
  rows: T[],
  r: RunOwnerRefresher
): Array<T & { activeRun?: ActiveRun }> {
  return rows.map(row => {
    const activeRun = row.webUrl ? r.ownerFor(row.webUrl) : undefined;
    return activeRun ? { ...row, activeRun } : row;
  });
}

/** Each row's handoffs whose edge still holds. Conflicts count as needing a
    rebase here, though triage's own facts keep them apart. */
export function attachHandoffs<T extends BoardMR>(
  rows: T[],
  mem: DispatchMemory
): Array<T & { handoffs?: Partial<Record<HandoffKind, Handoff>> }> {
  return rows.map(row => {
    const m = row.webUrl ? mem.mrs[row.webUrl] : undefined;
    if (!m?.handoffs) return row;
    const handoffs = liveHandoffs(m, {
      pipelineId: row.pipeline ? numericPipelineId(row.pipeline.id) : null,
      pipelineFailed: row.pipelineState === 'failed',
      needsRebase: row.blockers.needsRebase || row.blockers.hasConflicts,
    });
    return Object.keys(handoffs).length > 0 ? { ...row, handoffs } : row;
  });
}
