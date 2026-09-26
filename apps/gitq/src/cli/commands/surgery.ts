import { loadStore, updateStore } from '../../core/persistence.ts';
import { AbsorbEngine } from '../../core/absorb.ts';
import type { AbsorbResult, AbsorbTarget } from '../../core/absorb.ts';
import { BranchSplitter } from '../../core/branch-splitter.ts';
import { foldBranch } from '../../core/branch-fold.ts';
import { reparentBranch } from '../../core/reparent.ts';
import { renameBranch } from '../../core/branch-rename.ts';
import { resetToRemote } from '../../core/branch-reset.ts';
import { GitShell } from '../../core/git-shell.ts';
import { StackManager } from '../../core/stack-manager.ts';
import { getWorktreeMap, findSlotForBranch, describeSlot } from '../../core/worktrees.ts';
import type { SlotInfo } from '../../core/worktrees.ts';
import type { Stack, StackStore } from '../../core/types.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { requireStackFree, withLeasedSlot } from '../slots.ts';
import { withOperationLog } from '../op-log.ts';
import { pickStack, pickStackVia } from './crud.ts';
import { finishCascade } from './cascade.ts';

/** Mirrors crud.ts's local helper — replace one stack in the store by id. */
function replaceStack(store: StackStore, updated: Stack): StackStore {
  return { ...store, stacks: store.stacks.map((s) => (s.id === updated.id ? updated : s)) };
}

/**
 * Surgery pre-guard: refuse when some worktree other than `ctx.repoRoot` holds
 * `branch`. These commands rewrite the branch ref directly in `ctx.repoRoot`, so
 * a copy checked out elsewhere would silently go stale.
 *
 * gitq's own slots refuse too, with different advice: working from a slot gitq
 * leases and resets is not something to suggest, so those are told to free it.
 */
function refuseIfCheckedOutElsewhere(ctx: CliContext, map: SlotInfo[], branch: string): number | null {
  const owner = findSlotForBranch(map, branch);
  if (owner && owner.path !== ctx.repoRoot) {
    const advice = owner.isWorkSlot
      ? 'gitq leaves its slots detached, so free that slot first'
      : 'run this from that worktree or free the branch first';
    return fail(`branch "${branch}" is checked out in ${describeSlot(owner)}; ${advice}`);
  }
  return null;
}

/**
 * Name the files absorb would not commit because the edit does not replay onto
 * the branch it was headed for.
 *
 * Silence here would read as "that file was fine", when in fact it is still
 * dirty and the human's fix went nowhere. Worth its own line, separate from the
 * unattributed count, because the remedy is different: pick another branch, or
 * split the edit up.
 */
function appendUnapplied(
  headline: string,
  unapplied: string[] | undefined,
  targets: AbsorbTarget[],
): string {
  if (!unapplied || unapplied.length === 0) return headline;
  // Only a lone catch-all sends every file to one place, so only then can the
  // message name the branch without checking which target claimed each file.
  const only = targets.length === 1 && targets[0]!.glob === undefined ? targets[0]!.branch : null;
  const target = only ? ` onto ${only}` : ' onto the branch it was attributed to';
  const files = unapplied.map((f) => `  ${f}: does not replay${target}, left in the worktree`);
  return [headline, ...files].join('\n');
}

/**
 * Parse the repeatable `--at` flag.
 *
 * `--at <branch>` is the catch-all (everything no glob claimed); there can be
 * only one, since two would each claim "the rest". `--at <branch>:<glob>`
 * claims just its matches, so several may be given. Git refs cannot contain
 * `:`, which is what makes the first colon an unambiguous split.
 */
function parseAtTargets(raw: unknown, stack: Stack): AbsorbTarget[] | { error: string } {
  const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
    (v): v is string => typeof v === 'string',
  );

  const targets: AbsorbTarget[] = [];
  for (const value of values) {
    const colon = value.indexOf(':');
    const branch = colon === -1 ? value : value.slice(0, colon);
    const glob = colon === -1 ? undefined : value.slice(colon + 1);

    if (!branch) return { error: `--at "${value}" has no branch before the colon` };
    if (colon !== -1 && !glob) {
      return {
        error: `--at "${value}" has a colon but no glob after it; drop the colon to send everything to "${branch}"`,
      };
    }
    // Checked here, before anything reads the worktree: a target outside the
    // stack would key the attribution map on a branch the commit walk never
    // visits, so its files would go nowhere at all.
    if (!StackManager.findNode(stack, branch)) {
      return {
        error: `--at "${branch}" is not in stack "${stack.stackName}" (have: ${stack.nodes.map((n) => n.branch).join(', ')})`,
      };
    }
    targets.push(glob === undefined ? { branch } : { branch, glob });
  }

  const bare = targets.filter((t) => t.glob === undefined);
  if (bare.length > 1) {
    return {
      error: `only one bare --at is allowed (the catch-all); got ${bare.map((t) => `--at ${t.branch}`).join(' and ')}. Scope all but one with --at <branch>:<glob>`,
    };
  }

  return targets;
}

export async function absorbCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);

  const parsed = parseAtTargets(ctx.flags.at, stack);
  if ('error' in parsed) return fail(parsed.error);
  const at = parsed;

  if (ctx.flags.preview === true) {
    // Preview mutates nothing — no pause guard, no operation-log entry.
    const preview = await AbsorbEngine.previewAbsorb(ctx.repoRoot, stack, at);
    const attributedCount = Object.keys(preview.attributed).length;
    const headline = `absorb preview: ${attributedCount} branch(es) attributed, ${preview.unattributed.length} file(s) left in the worktree`;
    emit(ctx, appendUnapplied(headline, preview.unapplied, at), { stack, result: preview });
    return 0;
  }

  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  // The amend phase checks each attributed branch out in the launch tree;
  // a branch held by another slot would fail halfway through. Refuse it
  // upfront with the preview's attribution.
  const preview = await AbsorbEngine.previewAbsorb(ctx.repoRoot, stack, at);
  const map = await getWorktreeMap(ctx.repoRoot);
  for (const attributedBranch of Object.keys(preview.attributed)) {
    const preGuard = refuseIfCheckedOutElsewhere(ctx, map, attributedBranch);
    if (preGuard !== null) return preGuard;
  }

  // No branch owns any of it, so the engine would return without stashing,
  // checking out, or committing anything. Say so from here: leasing a slot
  // materializes a work worktree, and there is nothing for it to restack.
  if (Object.keys(preview.attributed).length === 0) {
    const reason = preview.unattributed.length === 0 ? 'no-changes' : 'nothing-attributable';
    const result: AbsorbResult = {
      absorbed: false,
      reason,
      attributions: [],
      unattributed: preview.unattributed,
      unapplied: preview.unapplied,
    };
    emit(ctx, appendUnapplied(`nothing absorbed (${reason})`, preview.unapplied, at), { stack, result });
    return 0;
  }

  // Absorb has no pause protocol (see below), but the restack it runs after
  // committing can still conflict and needs a work slot leased against the
  // stack for the duration — same as sync/reparent's cascade phase. The
  // commit phase (attribution + amend) stays in ctx.repoRoot either way.
  return withLeasedSlot(ctx, stack, 'absorb', (workDir) =>
    withOperationLog(ctx, stack, 'absorb', async () => {
      const result = await AbsorbEngine.absorb(ctx.repoRoot, stack, undefined, workDir, at);
      const updatedStack = result.updatedStack ?? stack;
      if (result.updatedStack) {
        await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, updatedStack));
      }

      // A descendant restack that conflicts leaves git mid-rebase, but absorb has
      // no pause protocol (unlike sync/reparent) — cascadeAfterAbsorb just breaks
      // and reports state 'completed'. Don't strand the caller mid-rebase with a
      // success exit: abort the in-progress rebase and fail, pointing them at
      // `gitq sync` which restacks with full conflict handling.
      const cascadeFailure = result.cascadeResult?.results.find((r) => !r.success);
      if (cascadeFailure) {
        await GitShell.rebaseAbort(ctx.repoRoot).catch(() => {}); // tolerate not-in-rebase
        return fail(
          `absorb restack conflicted on ${cascadeFailure.branch}; aborted the rebase (branch edits kept). run gitq sync to restack with full conflict handling`,
        );
      }

      const failed = result.attributions.some((a) => !a.success);
      const absorbedLine = result.absorbed
        ? `absorbed: ${result.attributions.map((a) => `${a.branch} (${a.files.length})`).join(', ')}`
        : `nothing absorbed${result.reason ? ` (${result.reason})` : ''}`;
      const headline = appendUnapplied(absorbedLine, result.unapplied, at);
      // `recovery` means work of the human's is sitting somewhere they have to
      // go get: the stash absorb kept, or a branch it could not leave. Print it
      // with the headline and exit non-zero even when the commits landed.
      emit(ctx, result.recovery ? `${headline}\n${result.recovery}` : headline, {
        stack: updatedStack,
        result,
      });
      return failed || result.recovery ? 1 : 0;
    }),
  );
}

export async function splitCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  const name = typeof ctx.flags.name === 'string' ? ctx.flags.name : null;
  // --at is repeatable for absorb, so it arrives as an array; split takes a
  // single rev and says so rather than silently using the first.
  const atValues = Array.isArray(ctx.flags.at) ? ctx.flags.at : ctx.flags.at === undefined ? [] : [ctx.flags.at];
  if (atValues.length > 1) return fail('gitq split takes a single --at <rev>');
  const at = typeof atValues[0] === 'string' ? atValues[0] : null;
  const files = typeof ctx.flags.files === 'string' ? ctx.flags.files : null;

  if (!branch || !name || (!at && !files) || (at && files)) {
    return fail('usage: gitq split <branch> --at <rev> --name <newBranch> | gitq split <branch> --files <glob[,glob...]> --name <newBranch> [--stack <name>]');
  }

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, branch);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  // No checked-out-elsewhere pre-guard here: both modes are ref surgery now.
  // --at never touches a working tree; --files builds detached in a leased
  // slot. A source branch checked out elsewhere is handled by the slot
  // policy inside finalizeBranchRef (clean: auto-reset, dirty: refuse).
  if (at) {
    return withOperationLog(ctx, stack, 'split', async () => {
      const result = await BranchSplitter.tailSplit(ctx.repoRoot, stack, branch, name, at);
      await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, result.updatedStack));
      emit(ctx, `split ${branch}: moved ${result.movedCommits.length} commit(s) to ${result.newBranch}`, {
        stack: result.updatedStack,
        result,
      });
      return 0;
    });
  }

  return withLeasedSlot(ctx, stack, 'split', (workDir) =>
    withOperationLog(ctx, stack, 'split', async () => {
      const patterns = files!.split(',').map((p) => p.trim()).filter(Boolean);
      const result = await BranchSplitter.splitByFile(ctx.repoRoot, stack, branch, patterns, name, workDir);
      await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, result.newStack));
      emit(ctx, `split ${branch}: moved ${result.movedFiles.length} file(s) to ${result.newBranch}`, {
        stack: result.newStack,
        result,
      });
      return 0;
    }),
  );
}

export async function foldCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  if (!branch) return fail('usage: gitq fold <branch> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, branch);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  return withLeasedSlot(ctx, stack, 'fold', (workDir) =>
    withOperationLog(ctx, stack, 'fold', async () => {
      const result = await foldBranch(ctx.repoRoot, stack, branch, workDir);
      await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, result.newStack));
      emit(ctx, `folded ${result.foldedBranch} into ${result.intoParent}`, { stack: result.newStack, result });
      return 0;
    }),
  );
}

export async function reparentCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  const onto = typeof ctx.flags.onto === 'string' ? ctx.flags.onto : null;
  if (!branch || !onto) return fail('usage: gitq reparent <branch> --onto <newParent> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, branch);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  // reparentBranch runs both its own --onto rebase and the moved branch's
  // descendant cascade detached in the leased work slot; either can pause
  // or refuse on a conflict exactly like `gitq sync` does. Lease a work slot
  // for the duration so a paused reparent, like a paused sync, is guarded by
  // a per-stack lease that `gitq continue`/`gitq abort` can resolve from
  // anywhere.
  return withLeasedSlot(ctx, stack, 'reparent', (workDir) =>
    // Log unless we paused (exit 2): a paused cascade is resolved via
    // continue/abort, not undo, so recording it would be misleading.
    withOperationLog(ctx, stack, 'reparent', async () => {
      const result = await reparentBranch(ctx.repoRoot, stack, branch, onto, workDir);

      // Reuse the same pause-file protocol sync uses so `gitq continue`/
      // `gitq abort` can resume it.
      if (result.cascadeResult?.state === 'paused') {
        return finishCascade(ctx, stack.id, result.cascadeResult, workDir);
      }

      await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, result.newStack));
      emit(ctx, `reparented ${result.branch} from ${result.oldParent} onto ${result.newParent}`, {
        stack: result.newStack,
        result,
      });
      // Align exit code with `gitq sync`: a completed cascade that had a failed
      // (non-conflict) result exits 1, not 0.
      const cascadeResults = result.cascadeResult?.results ?? [];
      return cascadeResults.every((r) => r.success) ? 0 : 1;
    }, (code) => code !== 2),
  );
}

export async function renameCommand(ctx: CliContext): Promise<number> {
  const [oldBranch, newBranch] = ctx.args;
  if (!oldBranch || !newBranch) return fail('usage: gitq rename <old> <new> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, oldBranch);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  const map = await getWorktreeMap(ctx.repoRoot);
  const preGuard = refuseIfCheckedOutElsewhere(ctx, map, oldBranch);
  if (preGuard !== null) return preGuard;

  return withOperationLog(ctx, stack, 'rename', async () => {
    const result = await renameBranch(ctx.repoRoot, stack, oldBranch, newBranch);
    await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, result.updatedStack));
    emit(ctx, `renamed ${oldBranch} to ${newBranch}`, { stack: result.updatedStack, result });
    return 0;
  });
}

export async function resetCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  if (!branch) return fail('usage: gitq reset <branch> [--stack <name>]');

  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, branch);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;

  // Keep the pre-guard even though resetToRemote is ref-only surgery now: a
  // branch held by another worktree refuses here with a pointer to it, rather
  // than deeper down in finalizeBranchRef's slot policy. That includes gitq's
  // own `gitq-N` slots since MAT-23 made the lookup see them; the narrow
  // work-slot check that used to sit here is now redundant.
  const map = await getWorktreeMap(ctx.repoRoot);
  const preGuard = refuseIfCheckedOutElsewhere(ctx, map, branch);
  if (preGuard !== null) return preGuard;

  // No HEAD capture/restore needed: resetToRemote CAS-moves the ref and never
  // checks anything out, so the launch worktree stays on its own branch.
  const result = await resetToRemote(ctx.repoRoot, stack, branch);
  await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, result.updatedStack));
  emit(ctx, `reset ${branch} to origin/${branch} (${result.newHead})`, { stack: result.updatedStack, result });
  return 0;
}
