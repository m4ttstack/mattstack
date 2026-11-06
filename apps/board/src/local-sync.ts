import {
  rtCommand,
  type Commands,
  type WorktreeSyncData,
} from '@mattstack/rt-client';

/** Provisioning plus rt sync's own five-minute ceiling. */
const LOCAL_SYNC_TIMEOUT_MS = 8 * 60_000;

/** MR urls with a sync running in this server process. */
export const LOCAL_SYNCS = new Set<string>();

export type LocalSyncOutcome = (
  | { kind: 'clean'; message: string }
  | { kind: 'conflict'; tree: string }
  | { kind: 'stopped'; message: string }
) & { log: string[] };

const STOP_WORDS: Partial<Record<WorktreeSyncData['kind'], string>> = {
  'no-tree': 'no worktree to sync in',
  'dirty-tree': 'the worktree has uncommitted changes',
  'stacked-refused': 'this branch is in a stack',
  'stack-unverified': 'could not check whether this branch is in a stack',
  'push-refused': 'rebased locally, but the push failed',
};

export function localSyncOutcome(data: WorktreeSyncData): LocalSyncOutcome {
  const log = data.log ?? [];
  if (data.kind === 'synced' && data.pushed)
    return { kind: 'clean', message: 'rebased and pushed', log };
  if (data.kind === 'synced')
    return { kind: 'stopped', message: 'rebased, not pushed', log };
  if (data.kind === 'up-to-date')
    return { kind: 'clean', message: 'already up to date', log };
  if (data.kind === 'conflict' && data.path)
    return { kind: 'conflict', tree: data.path, log };
  const word = STOP_WORDS[data.kind] ?? 'rt sync stopped';
  return {
    kind: 'stopped',
    message: data.refusal ? `${word}: ${data.refusal}` : word,
    log,
  };
}

/** The MR each running sync is for, keyed by the repo and branch the
    daemon names on every line it streams. */
const SYNC_TARGETS = new Map<string, string>();
/** Lines streamed so far for each MR with a sync running. */
export const LIVE_SYNC_LOGS = new Map<string, string[]>();

const targetKey = (repoName: string, branch: string) =>
  `${repoName}\0${branch}`;

export function startLiveSync(
  mrUrl: string,
  repoName: string,
  branch: string
): () => void {
  const key = targetKey(repoName, branch);
  SYNC_TARGETS.set(key, mrUrl);
  LIVE_SYNC_LOGS.set(mrUrl, []);
  return () => {
    if (SYNC_TARGETS.get(key) === mrUrl) SYNC_TARGETS.delete(key);
    LIVE_SYNC_LOGS.delete(mrUrl);
  };
}

/** Files a streamed line under its MR; the MR url when one is running. */
export function takeSyncLine(
  data: unknown
): { mrUrl: string; line: string } | null {
  const e = data as {
    repoName?: unknown;
    branch?: unknown;
    line?: unknown;
  } | null;
  if (
    typeof e?.repoName !== 'string' ||
    typeof e.branch !== 'string' ||
    typeof e.line !== 'string'
  )
    return null;
  const mrUrl = SYNC_TARGETS.get(targetKey(e.repoName, e.branch));
  const log = mrUrl ? LIVE_SYNC_LOGS.get(mrUrl) : undefined;
  if (!mrUrl || !log) return null;
  log.push(e.line);
  return { mrUrl, line: e.line };
}

type SyncCommand = typeof rtCommand<Commands['worktree:sync']['data']>;

export async function syncBranchLocally(
  repoName: string,
  branch: string,
  pausedTree?: string,
  command: SyncCommand = rtCommand
): Promise<LocalSyncOutcome> {
  const res = await command(
    'worktree:sync',
    { repoName, branch, ...(pausedTree ? { tree: pausedTree } : {}) },
    { timeoutMs: LOCAL_SYNC_TIMEOUT_MS }
  );
  if (!res.ok || !res.data)
    return {
      kind: 'stopped',
      message: `rt sync failed: ${res.error ?? 'no answer from the daemon'}`,
      log: [],
    };
  return localSyncOutcome(res.data);
}
