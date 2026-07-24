import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
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
 * Checks out the branch, resets to `origin/<branch>`, and updates
 * `lastKnownHead` in the stack.
 */
export async function resetToRemote(
  cwd: string,
  stack: Stack,
  branch: string,
): Promise<ResetToRemoteResult> {
  await assertCleanTree(cwd);

  const remoteRef = `origin/${branch}`;
  const remoteHead = await GitShell.getBranchHead(cwd, remoteRef);

  await GitShell.checkoutBranch(cwd, branch);
  await GitShell.resetHard(cwd, remoteRef);

  const updatedStack = StackManager.updateNode(stack, branch, {
    lastKnownHead: remoteHead,
  });

  return { updatedStack, newHead: remoteHead };
}
