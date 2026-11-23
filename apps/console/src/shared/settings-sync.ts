/** One thing waiting to reach origin, as the daemon's team snapshot reports it. */
export type PendingEntry =
  | {
      store: 'org' | `team:${string}`;
      repo?: string;
      key: string;
      change: 'added' | 'changed' | 'removed';
    }
  | { path: string; heldBack?: true };

/** The fields of `rt team status --json` the sync pill reads. */
export interface TeamStatusJson {
  branch: string | null;
  trial: boolean;
  lastPull: string | null;
  lastPushAt: string | null;
  conflicted: { at: string; detail: string } | null;
  pullOnly: boolean;
  heldBack: string[];
  pending: PendingEntry[] | null;
  lastPushError: string | null;
  lastCommitError: string | null;
  lastPullError: string | null;
  layoutHold: boolean;
  unownedDirty: string[];
  pullIntervalSec: number;
}

export type StuckReason =
  | 'conflict'
  | 'push-failed'
  | 'commit-failed'
  | 'unreachable'
  | 'trial'
  | 'layout-hold';

export type SyncState =
  | { kind: 'pushed'; lastPushAt: number | null }
  | { kind: 'waiting'; count: number }
  | { kind: 'stuck'; reason: StuckReason; detail: string | null }
  | { kind: 'unknown' };

export interface OrgSync {
  org: string;
  state: SyncState;
  pending: PendingEntry[];
  /** Managed paths changed on this Mac that its role may not push. */
  cantPush: string[];
  /** This Mac's own last successful push, never origin's tip time. */
  lastPushAt: number | null;
  pullIntervalSec: number;
  trialBranch: string | null;
}

export const DEFAULT_PULL_INTERVAL_SEC = 300;

function timeOf(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function deriveSyncState(
  status: TeamStatusJson | null,
  now: number
): SyncState {
  if (status === null || !Array.isArray(status.pending))
    return { kind: 'unknown' };
  if (status.conflicted) {
    return {
      kind: 'stuck',
      reason: 'conflict',
      detail: status.conflicted.detail,
    };
  }
  if (status.lastPushError) {
    return {
      kind: 'stuck',
      reason: 'push-failed',
      detail: status.lastPushError,
    };
  }
  if (status.lastCommitError) {
    return {
      kind: 'stuck',
      reason: 'commit-failed',
      detail: status.lastCommitError,
    };
  }
  if (status.lastPullError) {
    return {
      kind: 'stuck',
      reason: 'unreachable',
      detail: status.lastPullError,
    };
  }
  const lastPull = timeOf(status.lastPull);
  if (lastPull !== null && now - lastPull > 2 * status.pullIntervalSec * 1000) {
    return { kind: 'stuck', reason: 'unreachable', detail: null };
  }
  if (status.trial)
    return { kind: 'stuck', reason: 'trial', detail: status.branch };
  if (status.layoutHold)
    return { kind: 'stuck', reason: 'layout-hold', detail: null };
  if (status.pending.length > 0)
    return { kind: 'waiting', count: status.pending.length };
  return { kind: 'pushed', lastPushAt: timeOf(status.lastPushAt) };
}

export function orgSyncOf(
  org: string,
  status: TeamStatusJson | null,
  now: number
): OrgSync {
  return {
    org,
    state: deriveSyncState(status, now),
    pending: status?.pending ?? [],
    cantPush: status?.unownedDirty ?? [],
    lastPushAt: timeOf(status?.lastPushAt ?? null),
    pullIntervalSec: status?.pullIntervalSec ?? DEFAULT_PULL_INTERVAL_SEC,
    trialBranch: status?.trial ? status.branch : null,
  };
}
