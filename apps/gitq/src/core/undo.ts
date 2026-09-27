import type { Stack } from './types.ts';
import type { OperationEntry, OperationType } from './operation-log.ts';
import { GitShell } from './git-shell.ts';
import { finalizeBranchRef } from './rebase-engine.ts';
import { StackManager } from './stack-manager.ts';
import { describeSlot, findSlotForBranch, getWorktreeMap } from './worktrees.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UndoResult {
  success: boolean;
  restoredBranches: string[];
  restoredStack: Stack;
  error?: string;
}

// ── Reversible operations ────────────────────────────────────────────────────

const REVERSIBLE_OPERATIONS: Set<OperationType> = new Set([
  'cascade-rebase',
  'reparent',
  'absorb',
  'sync',
]);

// ── Undo ─────────────────────────────────────────────────────────────────────

/**
 * Snapshotted branches parent-before-child, stack root excluded: gitq never
 * moves trunk. Branches in the snapshot but no longer in the tree come last.
 */
function undoOrder(entry: OperationEntry): string[] {
  const stack = entry.stackSnapshot;
  const ordered = StackManager.toposort(stack).map((n) => n.branch);
  const rest = Object.keys(entry.branchSnapshots).filter((b) => !ordered.includes(b));
  return [...ordered, ...rest].filter((b) => b !== stack.root && b in entry.branchSnapshots);
}

/** Returns true if the given operation entry can be undone. */
export function canUndo(entry: OperationEntry): boolean {
  return REVERSIBLE_OPERATIONS.has(entry.operation);
}

/**
 * Undo a previously logged operation by moving each stack branch back to its
 * snapshot SHA and restoring the stack tree from the snapshot.
 *
 * Refs move by compare-and-swap through finalizeBranchRef, never by checkout,
 * so undo works from any worktree and leaves the stack root alone. Every
 * branch is checked before any ref moves: one that moved since the operation
 * (newer commits), or is held by a worktree finalizeBranchRef would refuse,
 * refuses the whole undo. A CAS that still fails part way stops there and
 * reports the branches already restored; running undo again finishes it.
 */
export async function undo(
  cwd: string,
  entry: OperationEntry,
): Promise<UndoResult> {
  if (!canUndo(entry)) {
    return {
      success: false,
      restoredBranches: [],
      restoredStack: entry.stackSnapshot,
      error: `Operation "${entry.operation}" is not reversible`,
    };
  }

  const branches = Object.keys(entry.branchSnapshots);
  if (branches.length === 0) {
    return {
      success: false,
      restoredBranches: [],
      restoredStack: entry.stackSnapshot,
      error: 'No branch snapshots to restore',
    };
  }

  const refuse = (error: string): UndoResult => ({
    success: false,
    restoredBranches: [],
    restoredStack: entry.stackSnapshot,
    error,
  });

  if (await GitShell.isDirty(cwd)) {
    return refuse('the working tree has uncommitted changes; commit or stash them, then retry undo');
  }

  const slots = await getWorktreeMap(cwd);
  const steps: Array<{ branch: string; from: string; to: string; done: boolean }> = [];
  const skippedBranches: string[] = [];
  const movedSinceOperation: string[] = [];
  const heldBySlot: string[] = [];

  for (const branch of undoOrder(entry)) {
    const to = entry.branchSnapshots[branch];
    if (!to) continue;

    if (!(await GitShell.branchExists(cwd, branch))) {
      skippedBranches.push(branch);
      continue;
    }

    // Already at its snapshot: restored by an earlier undo that stopped part way.
    const current = await GitShell.getBranchHead(cwd, branch);
    if (current === to) {
      steps.push({ branch, from: current, to, done: true });
      continue;
    }

    const from = entry.resultHeads?.[branch] ?? current;
    if (current !== from) {
      movedSinceOperation.push(branch);
      continue;
    }

    // The refusals finalizeBranchRef makes, checked up front so the common
    // case moves nothing; finalizeBranchRef still makes them to catch a race.
    const owner = findSlotForBranch(slots, branch);
    const blocked = !owner
      ? null
      : owner.dirty
        ? 'dirty'
        : owner.rebaseInProgress
          ? 'mid-rebase'
          : owner.head !== from
            ? 'not on the branch head'
            : null;
    if (owner && blocked) {
      heldBySlot.push(`${branch} is checked out in ${describeSlot(owner)}, which is ${blocked}`);
      continue;
    }
    steps.push({ branch, from, to, done: false });
  }

  const refusals: string[] = [];
  if (movedSinceOperation.length > 0) {
    refusals.push(`moved since the ${entry.operation}, so undo would drop newer commits: ${movedSinceOperation.join(', ')}`);
  }
  refusals.push(...heldBySlot);
  if (refusals.length > 0) return refuse(refusals.join('; '));

  const restoredBranches: string[] = [];
  for (const { branch, from, to, done } of steps) {
    if (done) {
      restoredBranches.push(branch);
      continue;
    }
    const moved = await finalizeBranchRef(cwd, branch, from, to);
    if (!moved.success) {
      return {
        success: false,
        restoredBranches,
        restoredStack: entry.stackSnapshot,
        error: `could not restore ${branch}: ${moved.error}`,
      };
    }
    restoredBranches.push(branch);
  }

  const result: UndoResult = {
    success: true,
    restoredBranches,
    restoredStack: structuredClone(entry.stackSnapshot),
  };

  if (skippedBranches.length > 0) {
    result.error = `Skipped deleted branches: ${skippedBranches.join(', ')}`;
  }

  return result;
}
