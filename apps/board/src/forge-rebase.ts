import type { GitLabProvider, PullRequest } from '@mattstack/glance';
import { rtCommand } from '@mattstack/rt-client';

export type ForgeKind = 'gitlab' | 'github';

export type ForgeRebaseResult =
  | { kind: 'rebased'; sha: string | null }
  | { kind: 'current' }
  | { kind: 'unclear' }
  | { kind: 'failed'; reason: string; conflicts: boolean }
  | { kind: 'cannot' }
  | { kind: 'cancelled' };

export interface ForgeRebaseRead {
  sha: string | null;
  rebaseInProgress: boolean;
  mergeError: string | null;
  conflicts: boolean;
  divergedCommitsCount: number | null;
}

export interface ForgeRebaseDeps {
  forge: ForgeKind;
  canRebase: boolean;
  read: () => Promise<ForgeRebaseRead>;
  rebase: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  pollMs?: number;
}

/** rt's REBASE_POLL_MS. */
const DEFAULT_POLL_MS = 5_000;

const CONFLICT_REASON = 'the branch has conflicts with its target';

export class CannotRebaseError extends Error {}

export async function forgeRebase(
  deps: ForgeRebaseDeps
): Promise<ForgeRebaseResult> {
  if (!deps.canRebase) return { kind: 'cannot' };
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;

  let before: string | null = null;
  try {
    before = (await deps.read()).sha;
  } catch {
    before = null;
  }
  if (deps.signal.aborted) return { kind: 'cancelled' };

  try {
    await deps.rebase();
  } catch (err) {
    if (err instanceof CannotRebaseError) return { kind: 'cannot' };
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: 'failed',
      reason,
      conflicts: reason.includes('RebaseConflictError'),
    };
  }

  return deps.forge === 'github'
    ? waitForHead(deps, before, pollMs)
    : waitForFlag(deps, before, pollMs);
}

async function waitForFlag(
  deps: ForgeRebaseDeps,
  before: string | null,
  pollMs: number
): Promise<ForgeRebaseResult> {
  for (;;) {
    if (deps.signal.aborted) return { kind: 'cancelled' };
    let now: ForgeRebaseRead | null = null;
    try {
      now = await deps.read();
    } catch {
      now = null;
    }
    if (now) {
      if (now.sha !== null && before !== null && now.sha !== before)
        return { kind: 'rebased', sha: now.sha };
      if (!now.rebaseInProgress) {
        if (now.sha !== null && before === null)
          return { kind: 'rebased', sha: now.sha };
        if (now.mergeError)
          return { kind: 'failed', reason: now.mergeError, conflicts: false };
        if (now.conflicts)
          return { kind: 'failed', reason: CONFLICT_REASON, conflicts: true };
        if (now.divergedCommitsCount === 0) return { kind: 'current' };
        return { kind: 'unclear' };
      }
    }
    await deps.sleep(pollMs);
    if (deps.signal.aborted) return { kind: 'cancelled' };
  }
}

/** GitHub's mutation returns before the rebase lands and exposes no
    in-progress flag, so the head moving is the only signal. An unknown head
    before the call leaves nothing to compare against. */
async function waitForHead(
  deps: ForgeRebaseDeps,
  before: string | null,
  pollMs: number
): Promise<ForgeRebaseResult> {
  if (before === null) return { kind: 'unclear' };
  for (;;) {
    if (deps.signal.aborted) return { kind: 'cancelled' };
    try {
      const now = await deps.read();
      if (now.sha !== null && now.sha !== before)
        return { kind: 'rebased', sha: now.sha };
    } catch {
      // the next read may succeed
    }
    await deps.sleep(pollMs);
    if (deps.signal.aborted) return { kind: 'cancelled' };
  }
}

type RebaseDeps = Omit<ForgeRebaseDeps, 'signal' | 'sleep'>;

function readOf(pr: PullRequest, forge: ForgeKind): ForgeRebaseRead {
  return {
    sha: pr.sha ?? null,
    rebaseInProgress: forge === 'gitlab' ? pr.rebaseInProgress : false,
    mergeError: pr.mergeError ?? null,
    conflicts: pr.conflicts,
    divergedCommitsCount: pr.divergedCommitsCount ?? null,
  };
}

export function gitlabRebaseDeps(
  provider: GitLabProvider,
  path: string,
  iid: number
): RebaseDeps {
  return {
    forge: 'gitlab',
    canRebase: true,
    read: async () => {
      const pr = await provider.fetchSingleMR(path, iid, null);
      if (!pr) throw new Error(`${path}!${iid} could not be read`);
      return readOf(pr, 'gitlab');
    },
    rebase: () => provider.rebasePullRequest(path, iid),
  };
}

const CANNOT_REBASE_PREFIX = 'GitHub cannot rebase';

export function githubRebaseDeps(
  repoName: string,
  iid: number,
  command: typeof rtCommand = rtCommand
): RebaseDeps {
  return {
    forge: 'github',
    canRebase: true,
    read: async () => {
      const res = await command<{ mr: PullRequest }>('mr:get', {
        repoName,
        iid,
        refresh: true,
      });
      if (!res.ok || !res.data)
        throw new Error(res.error ?? 'no answer from the daemon');
      return readOf(res.data.mr, 'github');
    },
    rebase: async () => {
      const res = await command('mr:action', {
        repoName,
        iid,
        action: 'rebase',
      });
      if (res.ok) return;
      const error = res.error ?? 'no answer from the daemon';
      if (error.startsWith(CANNOT_REBASE_PREFIX))
        throw new CannotRebaseError(error);
      throw new Error(error);
    },
  };
}
