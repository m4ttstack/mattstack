import type { Stack } from './types.ts';
import { StackManager, StackError } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { assertCleanTree } from './git-guards.ts';

/** Result of folding a branch into its parent. */
export interface FoldResult {
  /** The branch that was folded (deleted). */
  foldedBranch: string;
  /** The parent branch that absorbed the commits. */
  intoParent: string;
  /** Children that were re-parented from foldedBranch to intoParent. */
  reParentedChildren: string[];
  /** Updated stack with the folded node removed and children re-parented. */
  newStack: Stack;
}

/**
 * Fold a branch into its parent: cherry-pick its commits onto the parent,
 * delete the branch, re-parent its children, and return the updated stack.
 */
export async function foldBranch(
  cwd: string,
  stack: Stack,
  branch: string,
): Promise<FoldResult> {
  const node = StackManager.findNode(stack, branch);
  if (!node) {
    throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
  }

  const parentBranch = node.parent;
  if (parentBranch === stack.root && !StackManager.findNode(stack, parentBranch)) {
    // Parent is the root (e.g. "main") — that's fine, we can fold onto it
  }

  await assertCleanTree(cwd);

  await GitShell.checkoutBranch(cwd, parentBranch);

  // Only replay commits if the branch has commits beyond its parent.
  // Zero-commit branches (same HEAD as parent) have nothing to fold.
  const parentHead = await GitShell.getBranchHead(cwd, parentBranch);
  const branchHead = await GitShell.getBranchHead(cwd, branch);
  if (branchHead !== parentHead) {
    // Use rebase --onto instead of cherry-pick to handle merge commits.
    // cherry-pick fails on merge commits without -m, but rebase handles
    // them correctly by linearizing the history.
    const mergeBase = await GitShell.getMergeBase(cwd, parentBranch, branch);
    await GitShell.rebaseOnto(cwd, parentBranch, mergeBase, branch);

    // Now fast-forward the parent to include the rebased commits
    await GitShell.checkoutBranch(cwd, parentBranch);
    await GitShell.resetHard(cwd, branch);
  }

  // Delete the folded branch
  await GitShell.deleteBranch(cwd, branch);

  // Update the stack tree: re-parent children, then remove the node
  const children = StackManager.getChildren(stack, branch);
  let updatedStack = stack;

  for (const child of children) {
    updatedStack = StackManager.moveNode(updatedStack, child.branch, parentBranch);
  }

  updatedStack = StackManager.removeNode(updatedStack, branch);

  // Update lastKnownHead on the parent
  const newParentHead = await GitShell.getBranchHead(cwd, parentBranch);
  if (StackManager.findNode(updatedStack, parentBranch)) {
    updatedStack = StackManager.updateNode(updatedStack, parentBranch, {
      lastKnownHead: newParentHead,
    });
  }

  return {
    foldedBranch: branch,
    intoParent: parentBranch,
    reParentedChildren: children.map((c) => c.branch),
    newStack: updatedStack,
  };
}
