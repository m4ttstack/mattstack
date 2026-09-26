import type { Stack } from './types.ts';
import type { OperationEntry, OperationType } from './operation-log.ts';
import { GitShell } from './git-shell.ts';

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

/** Returns true if the given operation entry can be undone. */
export function canUndo(entry: OperationEntry): boolean {
  return REVERSIBLE_OPERATIONS.has(entry.operation);
}

/**
 * Undo a previously logged operation by resetting branches to their snapshot SHAs
 * and restoring the stack tree from the snapshot.
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

  const originalBranch = await GitShell.getCurrentBranch(cwd);
  const restoredBranches: string[] = [];
  const skippedBranches: string[] = [];

  for (const branch of branches) {
    const sha = entry.branchSnapshots[branch];
    if (!sha) continue;

    const exists = await GitShell.branchExists(cwd, branch);
    if (!exists) {
      skippedBranches.push(branch);
      continue;
    }

    await GitShell.checkoutBranch(cwd, branch);
    await GitShell.resetHard(cwd, sha);
    restoredBranches.push(branch);
  }

  // Return to the original branch if it still exists
  try {
    await GitShell.checkoutBranch(cwd, originalBranch);
  } catch {
    // If the original branch was removed, stay on the last restored branch
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
