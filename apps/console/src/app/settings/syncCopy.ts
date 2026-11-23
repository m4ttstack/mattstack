import type {
  OrgSync,
  PendingEntry,
  StuckReason,
  SyncState,
} from '../../shared/settings-sync';

export function pillLabel(state: SyncState): string {
  switch (state.kind) {
    case 'pushed':
      return 'Pushed';
    case 'waiting':
      return `${state.count} waiting`;
    case 'stuck':
      return 'Not pushing';
    case 'unknown':
      return 'Sync unknown';
  }
}

export function agoText(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function pullMinutes(sync: OrgSync): number {
  return Math.max(1, Math.round(sync.pullIntervalSec / 60));
}

export function lastPushText(sync: OrgSync, now: number): string {
  return sync.lastPushAt === null
    ? 'No push from this Mac yet'
    : `Last pushed ${agoText(sync.lastPushAt, now)}`;
}

/** Why a stuck org is not pushing, and what moves it on. */
export const STUCK_COPY: Record<StuckReason, { why: string; fix: string }> = {
  conflict: {
    why: "A teammate's change clashes with yours, so nothing pushes until it is settled.",
    fix: 'rt team status shows the clash and how to settle it.',
  },
  'push-failed': {
    why: 'The last push failed. Your saves stay on this Mac until one goes through.',
    fix: 'Check the git sign-in with rt setup, then try again.',
  },
  'commit-failed': {
    why: "The org copy on this Mac couldn't record your changes.",
    fix: 'rt team status shows what git refused.',
  },
  unreachable: {
    why: "This Mac hasn't reached the org repo lately, so pushes may not be landing.",
    fix: 'Check the network and the git sign-in with rt setup.',
  },
  trial: {
    why: 'This Mac is on a trial branch, and changes there never push.',
    fix: "Go back to the org's branch with rt team branch use.",
  },
  'layout-hold': {
    why: 'The org repo changed shape, and this Mac holds its changes until it can follow.',
    fix: 'Update mattstack, then the next pull carries on.',
  },
};

/** Push now cannot move these on; they need the fix first. */
export function pushHelps(state: SyncState): boolean {
  if (state.kind !== 'stuck') return state.kind !== 'unknown';
  return (
    state.reason === 'push-failed' ||
    state.reason === 'commit-failed' ||
    state.reason === 'unreachable'
  );
}

export function scopeText(entry: Extract<PendingEntry, { key: string }>) {
  const where =
    entry.store === 'org' ? 'org' : `${entry.store.slice('team:'.length)} team`;
  return entry.repo ? `${where} · ${entry.repo}` : where;
}

export function waitingTitle(count: number, org: string): string {
  return `${count} ${count === 1 ? 'change' : 'changes'} waiting to reach ${org}`;
}
