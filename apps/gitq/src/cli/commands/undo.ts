import { OperationLog } from '../../core/operation-log.ts';
import { canUndo, undo } from '../../core/undo.ts';
import { loadStore, saveStore } from '../../core/persistence.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';

export async function undoCommand(ctx: CliContext): Promise<number> {
  const entry = await OperationLog.getLastEntry();
  if (!entry) return fail('nothing to undo (operation log is empty)');
  if (!canUndo(entry)) return fail(`cannot undo "${entry.operation}" (not reversible)`);

  const result = await undo(ctx.repoRoot, entry);

  // Keep the persisted store in sync with the restored git state, mirroring
  // the snapshot's stack tree — but only if that stack is still tracked here
  // (the operation log is a single global file, not scoped per repo).
  if (result.success) {
    const store = await loadStore(ctx.repoRoot);
    if (store.stacks.some((s) => s.id === result.restoredStack.id)) {
      await saveStore(ctx.repoRoot, {
        ...store,
        stacks: store.stacks.map((s) => (s.id === result.restoredStack.id ? result.restoredStack : s)),
      });
    }
  }

  const human = result.success
    ? `undone: restored ${result.restoredBranches.join(', ') || 'no branches'}${result.error ? ` (${result.error})` : ''}`
    : `undo failed: ${result.error ?? 'unknown error'}`;
  emit(ctx, human, result);
  return result.success ? 0 : 1;
}
