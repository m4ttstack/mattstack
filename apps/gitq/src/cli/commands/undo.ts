import type { Stack } from '../../core/types.ts';
import { OperationLog, entryBelongsToRepo } from '../../core/operation-log.ts';
import { canUndo, undo } from '../../core/undo.ts';
import { loadStore, saveStore } from '../../core/persistence.ts';
import { GitShell } from '../../core/git-shell.ts';
import { StackManager } from '../../core/stack-manager.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { requireNoPause } from '../pause-file.ts';

/**
 * Remove nodes for branches git no longer has, reparenting their children to
 * the dropped node's parent so the tree stays well-formed. Processes nodes in
 * topological (parent-before-child) order so a run of consecutive dropped
 * ancestors still resolves each survivor to its nearest surviving ancestor.
 */
function dropMissingNodes(stack: Stack, missingBranches: Set<string>): Stack {
  let next = stack;
  for (const node of StackManager.toposort(stack)) {
    if (!missingBranches.has(node.branch)) continue;
    const current = StackManager.findNode(next, node.branch);
    if (!current) continue; // already removed while cleaning up an earlier ancestor
    for (const child of StackManager.getChildren(next, node.branch)) {
      next = StackManager.moveNode(next, child.branch, current.parent);
    }
    next = StackManager.removeNode(next, node.branch);
  }
  return next;
}

export async function undoCommand(ctx: CliContext): Promise<number> {
  const paused = await requireNoPause(ctx);
  if (paused !== null) return paused;

  // Scope to this repo: the operation log is a single global file, but an
  // operation is only undoable in the repo it ran in (its branch snapshots
  // reference that repo's refs). Pick the most recent entry belonging here.
  const entries = await OperationLog.load();
  const entry = [...entries].reverse().find((e) => entryBelongsToRepo(e, ctx.repoRoot));
  if (!entry) return fail('nothing to undo (no operations for this repo)');
  if (!canUndo(entry)) return fail(`cannot undo "${entry.operation}" (not reversible)`);

  const result = await undo(ctx.repoRoot, entry);

  // undo() may skip snapshotted branches whose git ref no longer exists (e.g.
  // deleted externally after the operation being undone). It only surfaces
  // that as prose in `result.error` — UndoResult has no structured skip list —
  // so re-derive it here the same way the engine detects it internally:
  // GitShell.branchExists, scoped to snapshotted branches the engine didn't
  // already confirm restored.
  let skippedBranches: string[] = [];
  let restoredStack = result.restoredStack;

  if (result.success) {
    const unconfirmed = Object.keys(entry.branchSnapshots).filter(
      (branch) => !result.restoredBranches.includes(branch),
    );
    const checks = await Promise.all(
      unconfirmed.map(async (branch) => [branch, await GitShell.branchExists(ctx.repoRoot, branch)] as const),
    );
    skippedBranches = checks.filter(([, exists]) => !exists).map(([branch]) => branch);

    if (skippedBranches.length > 0) {
      restoredStack = dropMissingNodes(restoredStack, new Set(skippedBranches));
    }

    // Keep the persisted store in sync with the restored git state, mirroring
    // the snapshot's stack tree (pruned of anything git no longer has) — but
    // only if that stack is still tracked here (the operation log is a single
    // global file, not scoped per repo).
    const store = await loadStore(ctx.repoRoot);
    if (store.stacks.some((s) => s.id === restoredStack.id)) {
      await saveStore(ctx.repoRoot, {
        ...store,
        stacks: store.stacks.map((s) => (s.id === restoredStack.id ? restoredStack : s)),
      });
    }
  }

  const skippedNote =
    skippedBranches.length > 0
      ? `; dropped from stack (branch no longer exists): ${skippedBranches.join(', ')}`
      : '';
  const human = result.success
    ? `undone: restored ${result.restoredBranches.join(', ') || 'no branches'}${skippedNote}${result.error ? ` (${result.error})` : ''}`
    : `undo failed: ${result.error ?? 'unknown error'}`;
  emit(ctx, human, { ...result, restoredStack, skippedBranches });
  return result.success ? 0 : 1;
}
