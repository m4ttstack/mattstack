import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';

export interface RenameResult {
  updatedStack: Stack;
}

/**
 * Rename a branch atomically: renames the git ref and updates the stack tree.
 *
 * The git rename happens first — if it fails (e.g. newBranch already exists
 * in git) the stack tree is left untouched. If the git rename succeeds but
 * the tree update throws, the caller must handle the inconsistency (unlikely
 * since StackManager is pure and validates upfront).
 */
export async function renameBranch(
  cwd: string,
  stack: Stack,
  oldBranch: string,
  newBranch: string,
): Promise<RenameResult> {
  await GitShell.renameBranch(cwd, oldBranch, newBranch);
  const updatedStack = StackManager.renameBranch(stack, oldBranch, newBranch);
  return { updatedStack };
}
