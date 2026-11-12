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
  /** A read during the wait failed (its message), or a read after one did
      succeed (null). The wait goes on either way. */
  onReadError?: (message: string | null) => void;
}

/** rt's REBASE_POLL_MS. */
const DEFAULT_POLL_MS = 5_000;

const CONFLICT_REASON = 'the branch has conflicts with its target';
const NO_PRE_READ = 'could not read the MR before rebasing';

export class CannotRebaseError extends Error {}

const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export async function forgeRebase(
  deps: ForgeRebaseDeps
): Promise<ForgeRebaseResult> {
  if (!deps.canRebase) return { kind: 'cannot' };
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;

  // Without the head before the call there is nothing to tell a rebase from
  // no change, so the rebase is never sent.
  let before: string | null = null;
  try {
    before = (await deps.read()).sha;
  } catch {
    before = null;
  }
  if (deps.signal.aborted) return { kind: 'cancelled' };
  if (before === null)
    return { kind: 'failed', reason: NO_PRE_READ, conflicts: false };

  try {
    await deps.rebase();
  } catch (err) {
    if (err instanceof CannotRebaseError) return { kind: 'cannot' };
    const reason = messageOf(err);
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

/** One read of the wait; null when it failed, which the caller is told
    about until a read succeeds again. */
function waitReader(deps: ForgeRebaseDeps) {
  let failing = false;
  return async (): Promise<ForgeRebaseRead | null> => {
    try {
      const now = await deps.read();
      if (failing) deps.onReadError?.(null);
      failing = false;
      return now;
    } catch (err) {
      failing = true;
      deps.onReadError?.(messageOf(err));
      return null;
    }
  };
}

async function waitForFlag(
  deps: ForgeRebaseDeps,
  before: string,
  pollMs: number
): Promise<ForgeRebaseResult> {
  const readOnce = waitReader(deps);
  for (;;) {
    if (deps.signal.aborted) return { kind: 'cancelled' };
    const now = await readOnce();
    // The head can move while GitLab is still rebasing, so nothing is
    // decided until the flag clears.
    if (now && !now.rebaseInProgress) {
      if (now.sha !== null && now.sha !== before)
        return { kind: 'rebased', sha: now.sha };
      if (now.mergeError)
        return { kind: 'failed', reason: now.mergeError, conflicts: false };
      if (now.conflicts)
        return { kind: 'failed', reason: CONFLICT_REASON, conflicts: true };
      if (now.divergedCommitsCount === 0) return { kind: 'current' };
      return { kind: 'unclear' };
    }
    await deps.sleep(pollMs);
    if (deps.signal.aborted) return { kind: 'cancelled' };
  }
}

/** GitHub's mutation returns before the rebase lands and exposes no
    in-progress flag, so the head moving is the only signal. */
async function waitForHead(
  deps: ForgeRebaseDeps,
  before: string,
  pollMs: number
): Promise<ForgeRebaseResult> {
  const readOnce = waitReader(deps);
  for (;;) {
    if (deps.signal.aborted) return { kind: 'cancelled' };
    const now = await readOnce();
    if (now && now.sha !== null && now.sha !== before)
      return { kind: 'rebased', sha: now.sha };
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
