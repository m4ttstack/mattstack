import { RebaseEngine, type CascadeResult } from '../../core/rebase-engine.ts';
import { loadStore, saveStore } from '../../core/persistence.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { pickStack } from './crud.ts';
import { readPause, writePause, clearPause, requireNoPause } from '../pause-file.ts';
import { withOperationLog } from '../op-log.ts';

/**
 * Persist a CascadeResult: writes the pause file (before saving the store,
 * see ordering note below) when paused, or clears it and saves when
 * completed. Shared by sync/continue here and by surgery commands (e.g.
 * reparent) whose descendant cascade can pause the same way.
 */
export async function finishCascade(ctx: CliContext, stackId: string, result: CascadeResult): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const updatedStore = {
    ...store,
    stacks: store.stacks.map((s) => (s.id === stackId ? result.updatedStack : s)),
  };

  if (result.state === 'paused' && result.pauseInfo) {
    // Write the pause file BEFORE saving the store: this preserves the
    // invariant "pause file present iff a rebase is in progress". A crash
    // between the two writes must not leave git mid-rebase with no pause
    // file, since sync's refuse-guard keys off the pause file's presence.
    await writePause(ctx.gitDir, { stackId, pauseInfo: result.pauseInfo });
    await saveStore(ctx.repoRoot, updatedStore);
    const types = (result.pauseInfo.conflictTypes ?? [])
      .map((c) => `${c.type} ${c.file}`).join('\n  ');
    emit(
      ctx,
      `paused on ${result.pauseInfo.currentBranch} (commit ${result.pauseInfo.commitIndex ?? '?'}/${result.pauseInfo.commitTotal ?? '?'}):\n  ${types}\nresolve with git, stage, then: gitq continue (or gitq abort)`,
      { state: 'paused', pauseInfo: result.pauseInfo },
    );
    return 2;
  }

  await saveStore(ctx.repoRoot, updatedStore);
  await clearPause(ctx.gitDir);
  emit(ctx, `${result.state}: ${result.results.map((r) => `${r.branch} ${r.success ? 'ok' : `FAILED (${r.error})`}`).join(', ')}`, {
    state: result.state,
    results: result.results,
    rebasedBranches: result.rebasedBranches ?? [],
  });
  return result.results.every((r) => r.success) ? 0 : 1;
}

export async function syncCommand(ctx: CliContext): Promise<number> {
  const paused = await requireNoPause(ctx);
  if (paused !== null) return paused;
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  // Log unless the cascade paused (exit 2): a paused cascade is resolved with
  // continue/abort, not undo.
  return withOperationLog(ctx, stack, 'sync', async () => {
    const result = await RebaseEngine.syncLocalStack(ctx.repoRoot, stack);
    return finishCascade(ctx, stack.id, result);
  }, (code) => code !== 2);
}

export async function continueCommand(ctx: CliContext): Promise<number> {
  const pause = await readPause(ctx.gitDir);
  if (!pause) return fail('nothing to continue (no pause file)');
  const store = await loadStore(ctx.repoRoot);
  const stack = store.stacks.find((s) => s.id === pause.stackId);
  if (!stack) return fail(`paused stack ${pause.stackId} no longer exists`);
  // Log a completed continue (exit 0/1) so it lands in `gitq log`; a re-pause
  // (exit 2) is not recorded.
  return withOperationLog(ctx, stack, 'sync', async () => {
    const result = await RebaseEngine.continueCascade(ctx.repoRoot, stack, pause.pauseInfo);
    return finishCascade(ctx, stack.id, result);
  }, (code) => code !== 2);
}

export async function abortCommand(ctx: CliContext): Promise<number> {
  await RebaseEngine.abortCascade(ctx.repoRoot);
  await clearPause(ctx.gitDir);
  emit(ctx, 'aborted', { state: 'aborted' });
  return 0;
}
