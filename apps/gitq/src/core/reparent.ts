import type { Stack } from './types.ts';
import { StackManager, StackError } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { RebaseEngine, type CascadeResult } from './rebase-engine.ts';
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
 * Runs `git rebase --onto <newParentHead> <oldBase> <branch>`, updates the
 * stack tree, and cascade-rebases all descendants of the moved branch.
 *
 * The git rebase happens first — if it fails the stack tree is unchanged.
 * After a successful rebase, the tree is updated and descendants are restacked.
 */
export async function reparentBranch(
  cwd: string,
  stack: Stack,
  branch: string,
  newParentBranch: string,
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

  await assertCleanTree(cwd);

  const oldBase = await GitShell.getMergeBase(cwd, branch, oldParent);
  const newParentHead = await GitShell.getBranchHead(cwd, newParentBranch);

  await GitShell.rebaseOnto(cwd, newParentHead, oldBase, branch);

  const newBranchHead = await GitShell.getBranchHead(cwd, branch);

  let newStack = StackManager.moveNode(stack, branch, newParentBranch);
  newStack = StackManager.updateNode(newStack, branch, { lastKnownHead: newBranchHead });

  let cascadeResult: CascadeResult | null = null;
  if (descendants.length > 0) {
    cascadeResult = await cascadeDescendants(cwd, newStack, branch);
    newStack = cascadeResult.updatedStack;
  }

  return {
    branch,
    oldParent,
    newParent: newParentBranch,
    cascadeResult,
    newStack,
  };
}

/**
 * Cascade-rebase descendants of a moved branch using merge-base resolution.
 *
 * After a reparent, the moved branch has a new HEAD. Its descendants need to
 * be rebased so their merge-base with their parent matches the parent's HEAD.
 */
async function cascadeDescendants(
  cwd: string,
  stack: Stack,
  movedBranch: string,
): Promise<CascadeResult> {
  const descendants = StackManager.getDescendants(stack, movedBranch);
  let updatedStack = stack;
  const results: import('./rebase-engine.ts').RebaseResult[] = [];

  for (const desc of descendants) {
    if (desc.unmanaged) continue;

    const parentHead = await GitShell.getBranchHead(cwd, desc.parent);
    const mb = await GitShell.getMergeBase(cwd, desc.branch, desc.parent);

    if (mb === parentHead) continue;

    const result = await RebaseEngine.rebaseSingle(cwd, parentHead, mb, desc.branch);
    results.push(result);

    if (!result.success) {
      // Mirror sync's pause construction (rebase-engine.ts doCascadeLoop): capture
      // two-letter conflict type codes and rebase progress so `gitq continue` and
      // consumers see the same rich pauseInfo they get from `gitq sync`.
      const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(
        () => [] as { file: string; type: string }[],
      );
      const conflictFiles = typedConflicts.length > 0
        ? typedConflicts.map((c) => c.file)
        : await GitShell.listConflictedFiles(cwd).catch(() => [] as string[]);
      if (conflictFiles.length > 0) {
        const idx = descendants.indexOf(desc);
        const progress = GitShell.getRebaseProgress(cwd);
        return {
          results,
          updatedStack,
          state: 'paused',
          pauseInfo: {
            currentBranch: desc.branch,
            conflictFiles,
            remainingBranches: descendants.slice(idx + 1).map((n) => n.branch),
            completedBranches: results.filter((r) => r.success).map((r) => r.branch),
            mergedBranch: null,
            newBase: movedBranch,
            phase: 'cascade',
            conflictTypes: typedConflicts,
            ...(progress ? { commitIndex: progress.current, commitTotal: progress.total } : {}),
          },
        };
      }
      break;
    }

    try {
      const newHead = await GitShell.getBranchHead(cwd, desc.branch);
      updatedStack = StackManager.updateNode(updatedStack, desc.branch, {
        lastKnownHead: newHead,
      });
    } catch {
      // Non-fatal
    }
  }

  return { results, updatedStack, state: 'completed' };
}
