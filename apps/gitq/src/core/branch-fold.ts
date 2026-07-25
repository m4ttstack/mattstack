import type { Stack } from './types.ts';
import { StackManager, StackError } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { assertCleanTree } from './git-guards.ts';
import { finalizeBranchRef } from './rebase-engine.ts';
import { getWorktreeMap, findSlotForBranch } from './worktrees.ts';

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
 *
 * Without a `workDir`, runs natively in `cwd`: checks out the parent,
 * rebases the folded branch's commits onto it, and fast-forwards.
 *
 * With a `workDir` (a leased, detached work slot), the fold rebase runs
 * detached in that slot and the parent is fast-forwarded by CAS via
 * `finalizeBranchRef` (slot policy applies). The launch tree is never
 * touched; a folded branch checked out elsewhere is handled by slot policy:
 * a clean slot is switched to the parent before deletion, a dirty slot
 * refuses upfront.
 */
export async function foldBranch(
  cwd: string,
  stack: Stack,
  branch: string,
  workDir?: string,
): Promise<FoldResult> {
  const node = StackManager.findNode(stack, branch);
  if (!node) {
    throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
  }
  const parentBranch = node.parent;

  if (!workDir) {
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

  // Detached fold: build the folded history in the work slot, fast-forward
  // the parent by CAS, then delete the branch. The launch tree is never
  // touched; a checked-out folded branch is handled by slot policy below.
  const map = await getWorktreeMap(cwd);
  const owner = findSlotForBranch(map, branch);
  if (owner && owner.dirty) {
    throw new StackError(
      `Branch "${branch}" is checked out in slot "${owner.name}" (${owner.path}) which is dirty; ` +
      `commit or stash there first (folding deletes the branch)`,
    );
  }

  const parentHead = await GitShell.getBranchHead(cwd, parentBranch);
  const branchHead = await GitShell.getBranchHead(cwd, branch);
  let foldedHead = branchHead;
  if (branchHead !== parentHead) {
    const mergeBase = await GitShell.getMergeBase(cwd, parentBranch, branch);
    try {
      await GitShell.detachAt(workDir, branchHead);
      await GitShell.rebaseOntoDetached(workDir, parentHead, mergeBase);
    } catch {
      const files = await GitShell.listConflictedFiles(workDir).catch(() => [] as string[]);
      await GitShell.rebaseAbort(workDir).catch(() => {});
      await GitShell.detachAt(workDir, 'HEAD').catch(() => {});
      throw new StackError(
        `Folding "${branch}" into "${parentBranch}" hit a rebase conflict` +
        `${files.length > 0 ? ` (${files.join(', ')})` : ''}; nothing was changed. ` +
        `Sync the stack first, then retry`,
      );
    }
    foldedHead = await GitShell.getBranchHead(workDir, 'HEAD');
  }

  const fin = await finalizeBranchRef(cwd, parentBranch, parentHead, foldedHead);
  await GitShell.detachAt(workDir, foldedHead).catch(() => {});
  if (!fin.success) throw new StackError(fin.error ?? 'could not move the parent ref');

  // Free the folded branch before deletion: a clean slot holding it moves
  // to the parent (falling back to a detached HEAD if the parent is itself
  // checked out elsewhere), so `git branch -D` cannot refuse.
  if (owner) {
    try {
      await GitShell.checkoutBranch(owner.path, parentBranch);
    } catch {
      await GitShell.detachAt(owner.path, foldedHead);
    }
  }
  await GitShell.deleteBranch(cwd, branch);

  // Update the stack tree: re-parent children, then remove the node
  const children = StackManager.getChildren(stack, branch);
  let updatedStack = stack;

  for (const child of children) {
    updatedStack = StackManager.moveNode(updatedStack, child.branch, parentBranch);
  }

  updatedStack = StackManager.removeNode(updatedStack, branch);

  if (StackManager.findNode(updatedStack, parentBranch)) {
    updatedStack = StackManager.updateNode(updatedStack, parentBranch, {
      lastKnownHead: foldedHead,
    });
  }

  return {
    foldedBranch: branch,
    intoParent: parentBranch,
    reParentedChildren: children.map((c) => c.branch),
    newStack: updatedStack,
  };
}
