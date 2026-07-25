import type { Stack } from './types.ts';
import { StackManager, StackError } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { RebaseEngine, finalizeBranchRef, type CascadeResult } from './rebase-engine.ts';
import { assertCleanTree } from './git-guards.ts';

export interface ReparentResult {
  branch: string;
  oldParent: string;
  newParent: string;
  /** Cascade result for the moved branch's descendants (if any). */
  cascadeResult: CascadeResult | null;
  newStack: Stack;
}

/**
 * Reparent a branch under a new parent.
 *
 * Without a `workDir`, runs `git rebase --onto <newParentHead> <oldBase>
 * <branch>` natively in `cwd`, updates the stack tree, and cascade-rebases
 * all descendants of the moved branch (also natively).
 *
 * With a `workDir` (a leased, detached work slot), the branch's own rebase
 * runs detached in that slot and finalizes by CAS via `finalizeBranchRef`;
 * a conflict there refuses cleanly, leaving every ref and tree untouched.
 * The descendant cascade then runs through `RebaseEngine.restackFrom`,
 * seeded with the branch's pre-rebase head so children compute their fork
 * point off the OLD head rather than a merge-base against the rewritten one.
 *
 * The git rebase happens first — if it fails the stack tree is unchanged.
 * After a successful rebase, the tree is updated and descendants are restacked.
 */
export async function reparentBranch(
  cwd: string,
  stack: Stack,
  branch: string,
  newParentBranch: string,
  workDir?: string,
): Promise<ReparentResult> {
  const node = StackManager.findNode(stack, branch);
  if (!node) {
    throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
  }

  const oldParent = node.parent;

  if (oldParent === newParentBranch) {
    return {
      branch,
      oldParent,
      newParent: newParentBranch,
      cascadeResult: null,
      newStack: stack,
    };
  }

  if (newParentBranch !== stack.root && !StackManager.findNode(stack, newParentBranch)) {
    throw new StackError(`New parent "${newParentBranch}" not found in stack "${stack.id}"`);
  }

  const descendants = StackManager.getDescendants(stack, branch);
  if (descendants.some((d) => d.branch === newParentBranch)) {
    throw new StackError(
      `Cannot reparent "${branch}" under "${newParentBranch}" — would create a cycle`,
    );
  }

  if (!workDir) await assertCleanTree(cwd);

  const oldBase = await GitShell.getMergeBase(cwd, branch, oldParent);
  const newParentHead = await GitShell.getBranchHead(cwd, newParentBranch);
  const oldHead = await GitShell.getBranchHead(cwd, branch);

  if (workDir) {
    // Detached: rebase in the work slot, CAS the ref, leave every tree as
    // it was. A conflict here refuses the whole reparent: nothing has moved
    // yet, so aborting is free and strictly better than stranding a
    // mid-rebase tree with no pause protocol for the pre-move phase.
    try {
      await GitShell.detachAt(workDir, oldHead);
      await GitShell.rebaseOntoDetached(workDir, newParentHead, oldBase);
    } catch {
      const files = await GitShell.listConflictedFiles(workDir).catch(() => [] as string[]);
      await GitShell.rebaseAbort(workDir).catch(() => {});
      await GitShell.detachAt(workDir, 'HEAD').catch(() => {});
      throw new StackError(
        `Reparenting "${branch}" onto "${newParentBranch}" hit a rebase conflict` +
        `${files.length > 0 ? ` (${files.join(', ')})` : ''}; nothing was moved. ` +
        `Sync the stack or resolve the divergence first, then retry`,
      );
    }
    const newHead = await GitShell.getBranchHead(workDir, 'HEAD');
    const fin = await finalizeBranchRef(cwd, branch, oldHead, newHead);
    await GitShell.detachAt(workDir, newHead).catch(() => {});
    if (!fin.success) throw new StackError(fin.error ?? 'could not move the branch ref');
  } else {
    await GitShell.rebaseOnto(cwd, newParentHead, oldBase, branch);
  }

  const newBranchHead = await GitShell.getBranchHead(cwd, branch);

  let newStack = StackManager.moveNode(stack, branch, newParentBranch);
  newStack = StackManager.updateNode(newStack, branch, { lastKnownHead: newBranchHead });

  let cascadeResult: CascadeResult | null = null;
  if (descendants.length > 0) {
    cascadeResult = await RebaseEngine.restackFrom(cwd, newStack, branch, workDir, {
      [branch]: oldHead,
    });
    newStack = cascadeResult.updatedStack;
  }

  return { branch, oldParent, newParent: newParentBranch, cascadeResult, newStack };
}
