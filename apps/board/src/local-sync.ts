import {
  rtCommand,
  type Commands,
  type WorktreeSyncData,
} from '@mattstack/rt-client';

/** Provisioning plus rt sync's own five-minute ceiling. */
const LOCAL_SYNC_TIMEOUT_MS = 8 * 60_000;

/** MR urls with a sync running in this server process. */
export const LOCAL_SYNCS = new Set<string>();

export type LocalSyncOutcome =
  | { kind: 'clean'; message: string }
  | { kind: 'conflict'; tree: string }
  | { kind: 'stopped'; message: string };

const STOP_WORDS: Partial<Record<WorktreeSyncData['kind'], string>> = {
  'tree-busy': 'a session is working in that worktree',
  'no-tree': 'no worktree to sync in',
  'dirty-tree': 'the worktree has uncommitted changes',
  'stacked-refused': 'this branch is in a stack',
  'stack-unverified': 'could not check whether this branch is in a stack',
  'push-refused': 'rebased locally, but the push failed',
};

export function localSyncOutcome(data: WorktreeSyncData): LocalSyncOutcome {
  if (data.kind === 'synced' && data.pushed)
    return { kind: 'clean', message: 'rebased and pushed' };
  if (data.kind === 'synced')
    return { kind: 'stopped', message: 'rebased, not pushed' };
  if (data.kind === 'up-to-date')
    return { kind: 'clean', message: 'already up to date' };
  if (data.kind === 'conflict' && data.path)
    return { kind: 'conflict', tree: data.path };
  const word = STOP_WORDS[data.kind] ?? 'rt sync stopped';
  return {
    kind: 'stopped',
    message: data.refusal ? `${word}: ${data.refusal}` : word,
  };
}

type SyncCommand = typeof rtCommand<Commands['worktree:sync']['data']>;

export async function syncBranchLocally(
  repoName: string,
  branch: string,
  command: SyncCommand = rtCommand
): Promise<LocalSyncOutcome> {
  const res = await command(
    'worktree:sync',
    { repoName, branch },
    { timeoutMs: LOCAL_SYNC_TIMEOUT_MS }
  );
  if (!res.ok || !res.data)
    return {
      kind: 'stopped',
      message: `rt sync failed: ${res.error ?? 'no answer from the daemon'}`,
    };
  return localSyncOutcome(res.data);
}
