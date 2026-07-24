import { loadStore, saveStore } from '../../core/persistence.ts';
import { AbsorbEngine } from '../../core/absorb.ts';
import { BranchSplitter } from '../../core/branch-splitter.ts';
import { foldBranch } from '../../core/branch-fold.ts';
import { reparentBranch } from '../../core/reparent.ts';
import { renameBranch } from '../../core/branch-rename.ts';
import { resetToRemote } from '../../core/branch-reset.ts';
import type { Stack, StackStore } from '../../core/types.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { pickStack } from './crud.ts';
import { finishCascade } from './cascade.ts';

/** Mirrors crud.ts's local helper — replace one stack in the store by id. */
function replaceStack(store: StackStore, updated: Stack): StackStore {
  return { ...store, stacks: store.stacks.map((s) => (s.id === updated.id ? updated : s)) };
}

export async function absorbCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);

  if (ctx.flags.preview === true) {
    const preview = await AbsorbEngine.previewAbsorb(ctx.repoRoot, stack);
    const attributedCount = Object.keys(preview.attributed).length;
    emit(
      ctx,
      `absorb preview: ${attributedCount} branch(es) attributed, ${preview.unattributed.length} file(s) fall back to ${preview.currentBranch}`,
      { stack, result: preview },
    );
    return 0;
  }

  const result = await AbsorbEngine.absorb(ctx.repoRoot, stack);
  const updatedStack = result.updatedStack ?? stack;
  if (result.updatedStack) {
    await saveStore(ctx.repoRoot, replaceStack(store, result.updatedStack));
  }

  const failed = result.attributions.some((a) => !a.success);
  emit(
    ctx,
    result.absorbed
      ? `absorbed: ${result.attributions.map((a) => `${a.branch} (${a.files.length})`).join(', ')}`
      : `nothing absorbed${result.reason ? ` (${result.reason})` : ''}`,
    { stack: updatedStack, result },
  );
  return failed ? 1 : 0;
}

export async function splitCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  const name = typeof ctx.flags.name === 'string' ? ctx.flags.name : null;
  const at = typeof ctx.flags.at === 'string' ? ctx.flags.at : null;
  const files = typeof ctx.flags.files === 'string' ? ctx.flags.files : null;

  if (!branch || !name || (!at && !files) || (at && files)) {
    return fail('usage: gitq split <branch> --at <sha> --name <newBranch> | gitq split <branch> --files <glob[,glob...]> --name <newBranch> [--stack <name>]');
  }

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);

  if (at) {
    const result = await BranchSplitter.tailSplit(ctx.repoRoot, stack, branch, name, at);
    await saveStore(ctx.repoRoot, replaceStack(store, result.updatedStack));
    emit(ctx, `split ${branch}: moved ${result.movedCommits.length} commit(s) to ${result.newBranch}`, {
      stack: result.updatedStack,
      result,
    });
    return 0;
  }

  const patterns = files!.split(',').map((p) => p.trim()).filter(Boolean);
  const result = await BranchSplitter.splitByFile(ctx.repoRoot, stack, branch, patterns, name);
  await saveStore(ctx.repoRoot, replaceStack(store, result.newStack));
  emit(ctx, `split ${branch}: moved ${result.movedFiles.length} file(s) to ${result.newBranch}`, {
    stack: result.newStack,
    result,
  });
  return 0;
}

export async function foldCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  if (!branch) return fail('usage: gitq fold <branch> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const result = await foldBranch(ctx.repoRoot, stack, branch);
  await saveStore(ctx.repoRoot, replaceStack(store, result.newStack));
  emit(ctx, `folded ${result.foldedBranch} into ${result.intoParent}`, { stack: result.newStack, result });
  return 0;
}

export async function reparentCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  const onto = typeof ctx.flags.onto === 'string' ? ctx.flags.onto : null;
  if (!branch || !onto) return fail('usage: gitq reparent <branch> --onto <newParent> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const result = await reparentBranch(ctx.repoRoot, stack, branch, onto);

  // reparentBranch cascades the moved branch's descendants; that cascade can
  // pause on a conflict exactly like `gitq sync` does. Reuse the same
  // pause-file protocol so `gitq continue`/`gitq abort` can resume it.
  if (result.cascadeResult?.state === 'paused') {
    return finishCascade(ctx, stack.id, result.cascadeResult);
  }

  await saveStore(ctx.repoRoot, replaceStack(store, result.newStack));
  emit(ctx, `reparented ${result.branch} from ${result.oldParent} onto ${result.newParent}`, {
    stack: result.newStack,
    result,
  });
  return 0;
}

export async function renameCommand(ctx: CliContext): Promise<number> {
  const [oldBranch, newBranch] = ctx.args;
  if (!oldBranch || !newBranch) return fail('usage: gitq rename <old> <new> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const result = await renameBranch(ctx.repoRoot, stack, oldBranch, newBranch);
  await saveStore(ctx.repoRoot, replaceStack(store, result.updatedStack));
  emit(ctx, `renamed ${oldBranch} to ${newBranch}`, { stack: result.updatedStack, result });
  return 0;
}

export async function resetCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  if (!branch) return fail('usage: gitq reset <branch> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const result = await resetToRemote(ctx.repoRoot, stack, branch);
  await saveStore(ctx.repoRoot, replaceStack(store, result.updatedStack));
  emit(ctx, `reset ${branch} to origin/${branch} (${result.newHead})`, { stack: result.updatedStack, result });
  return 0;
}
