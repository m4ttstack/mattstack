import { RebaseEngine, type CascadeResult } from '../../core/rebase-engine.ts';
import { loadStore, updateStore } from '../../core/persistence.ts';
import { GitShell } from '../../core/git-shell.ts';
import { releaseLease } from '../../core/leases.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { pickStack } from './crud.ts';
import { readPause, writePause, clearPause } from '../pause-file.ts';
import { withOperationLog } from '../op-log.ts';
import { findParkedLease, requireStackFree, slotGitDir, withLeasedSlot } from '../slots.ts';

/**
 * Persist a CascadeResult: writes the pause file (before saving the store,
 * see ordering note below) into the WORK SLOT's git dir when paused, or
 * clears it and saves when done. The locked updateStore keeps concurrent
 * cascades from losing each other's writes.
 */
export async function finishCascade(
  ctx: CliContext,
  stackId: string,
  result: CascadeResult,
  workDir: string,
): Promise<number> {
  const pauseDir = await slotGitDir(workDir);

  if (result.state === 'paused' && result.pauseInfo) {
    // Pause file BEFORE the store save: "pause file present iff a rebase is
    // in progress" must survive a crash between the two writes.
    await writePause(pauseDir, { stackId, pauseInfo: result.pauseInfo });
    await updateStore(ctx.repoRoot, (store) => ({
      ...store,
      stacks: store.stacks.map((s) => (s.id === stackId ? result.updatedStack : s)),
    }));
    const types = (result.pauseInfo.conflictTypes ?? [])
      .map((c) => `${c.type} ${c.file}`).join('\n  ');
    emit(
      ctx,
      `paused on ${result.pauseInfo.currentBranch} in ${workDir} (commit ${result.pauseInfo.commitIndex ?? '?'}/${result.pauseInfo.commitTotal ?? '?'}):\n  ${types}\nresolve with git in that worktree, stage, then: gitq continue (or gitq abort)`,
      { state: 'paused', pauseInfo: result.pauseInfo },
    );
    return 2;
  }

  await updateStore(ctx.repoRoot, (store) => ({
    ...store,
    stacks: store.stacks.map((s) => (s.id === stackId ? result.updatedStack : s)),
  }));
  await clearPause(pauseDir);
  emit(ctx, `${result.state}: ${result.results.map((r) => `${r.branch} ${r.success ? 'ok' : `FAILED (${r.error})`}`).join(', ')}`, {
    state: result.state,
    results: result.results,
    rebasedBranches: result.rebasedBranches ?? [],
  });
  return result.results.every((r) => r.success) ? 0 : 1;
}

export async function syncCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;
  return withLeasedSlot(ctx, stack, 'sync', (workDir) =>
    withOperationLog(ctx, stack, 'sync', async () => {
      const result = await RebaseEngine.syncLocalStack(ctx.repoRoot, stack, workDir);
      return finishCascade(ctx, stack.id, result, workDir);
    }, (code) => code !== 2),
  );
}

export async function continueCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const named = typeof ctx.flags.stack === 'string'
    ? store.stacks.find((s) => s.stackName === ctx.flags.stack)?.id
    : undefined;
  const located = await findParkedLease(ctx, named);
  if ('error' in located) return fail(located.error);
  const { lease } = located;
  const pauseDir = await slotGitDir(lease.slotPath);
  const pause = await readPause(pauseDir);
  if (!pause) return fail(`lease found but no pause file in ${lease.slotPath}; run: gitq abort`);
  const stack = store.stacks.find((s) => s.id === pause.stackId);
  if (!stack) return fail(`paused stack ${pause.stackId} no longer exists`);
  return withOperationLog(ctx, stack, 'sync', async () => {
    // Pass the PAUSE's worktree, not the lease slot: a reconcile-phase pause
    // is cwd-anchored (no worktreePath) and must continue in the launch tree.
    const result = await RebaseEngine.continueCascade(ctx.repoRoot, stack, pause.pauseInfo, pause.pauseInfo.worktreePath);
    const code = await finishCascade(ctx, stack.id, result, lease.slotPath);
    if (code !== 2) {
      await GitShell.detachAt(lease.slotPath, 'HEAD').catch(() => {});
      await releaseLease(ctx.commonDir, stack.id);
    }
    return code;
  }, (code) => code !== 2);
}

export async function abortCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const named = typeof ctx.flags.stack === 'string'
    ? store.stacks.find((s) => s.stackName === ctx.flags.stack)?.id
    : undefined;
  const located = await findParkedLease(ctx, named);
  if ('error' in located) return fail(located.error);
  const { lease } = located;
  const pauseDir = await slotGitDir(lease.slotPath);
  const pause = await readPause(pauseDir);
  // Abort where the rebase actually lives: the pause's worktree when set
  // (detached flow), else the launch tree (reconcile-phase pauses).
  await RebaseEngine.abortCascade(ctx.repoRoot, pause?.pauseInfo.worktreePath);
  await clearPause(pauseDir);
  await GitShell.detachAt(lease.slotPath, 'HEAD').catch(() => {});
  await releaseLease(ctx.commonDir, lease.stackId);
  emit(ctx, 'aborted', { state: 'aborted' });
  return 0;
}
