import type { Stack } from './types.ts';
import { StackManager, StackError } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { finalizeBranchRef } from './rebase-engine.ts';
import { assertCleanTree } from './git-guards.ts';

export interface ResetToRemoteResult {
  updatedStack: Stack;
  /** The SHA the branch was reset to. */
  newHead: string;
}

/**
 * Reset a local branch to match its remote tracking branch.
 *
 * Used when local and remote have diverged (e.g. force-pushed externally).
 * Pure ref surgery, the same shape as `split --at`: the branch ref is
 * CAS-moved to `origin/<branch>` via `finalizeBranchRef`, so no checkout ever
 * happens. A worktree already sitting cleanly on the branch gets the slot
 * policy (reset in place to the new head; dirty or drifted refuses), which
 * leaves every worktree on the branch it was already on.
 */
export async function resetToRemote(
  cwd: string,
  stack: Stack,
  branch: string,
): Promise<ResetToRemoteResult> {
  await assertCleanTree(cwd);

  const remoteRef = `origin/${branch}`;
  const remoteHead = await GitShell.getBranchHead(cwd, remoteRef);

  if (await GitShell.branchExists(cwd, `refs/heads/${branch}`)) {
    const localHead = await GitShell.getBranchHead(cwd, branch);
    const fin = await finalizeBranchRef(cwd, branch, localHead, remoteHead);
    if (!fin.success) throw new StackError(fin.error ?? `could not reset "${branch}" to ${remoteRef}`);
  } else {
    // No local ref to move: `git checkout <branch>` used to conjure one from
    // origin/<branch> (DWIM) as a side effect of the old checkout+reset. Keep
    // that recovery path, minus the checkout.
    await GitShell.branchAt(cwd, branch, remoteHead);
  }

  const updatedStack = StackManager.updateNode(stack, branch, {
    lastKnownHead: remoteHead,
  });

  return { updatedStack, newHead: remoteHead };
}
