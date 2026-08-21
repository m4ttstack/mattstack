import { StackManager } from '../../core/stack-manager.ts';
import { loadStore, updateStore } from '../../core/persistence.ts';
import type { Stack, StackStore } from '../../core/types.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { requireStackFree } from '../slots.ts';

/** Resolve --stack, defaulting to the repo's only stack. Throws with the available names otherwise. */
export function pickStack(store: StackStore, flags: Record<string, string | boolean>): Stack {
  const name = typeof flags.stack === 'string' ? flags.stack : null;
  if (name) {
    const found = store.stacks.find((s) => s.stackName === name);
    if (!found) throw new Error(`no stack named ${name} (have: ${store.stacks.map((s) => s.stackName).join(', ') || 'none'})`);
    return found;
  }
  if (store.stacks.length === 1) return store.stacks[0]!;
  throw new Error(`--stack required (have: ${store.stacks.map((s) => s.stackName).join(', ') || 'none'})`);
}

/**
 * Resolve --stack for a command that already names a branch inside the target
 * stack. A node branch belongs to exactly one stack, so naming it is as
 * specific as passing --stack; requiring both is a papercut. Falls back to
 * pickStack when the branch does not pin a single stack — notably a shared
 * root like `master`, which every stack in the repo may sit on.
 */
export function pickStackVia(store: StackStore, flags: Record<string, string | boolean>, branch: string): Stack {
  if (typeof flags.stack === 'string') return pickStack(store, flags);
  const owning = store.stacks.filter(
    (s) => s.root === branch || s.nodes.some((n) => n.branch === branch),
  );
  if (owning.length === 1) return owning[0]!;
  return pickStack(store, flags);
}

function replaceStack(store: StackStore, updated: Stack): StackStore {
  return { ...store, stacks: store.stacks.map((s) => (s.id === updated.id ? updated : s)) };
}

export async function trackCommand(ctx: CliContext): Promise<number> {
  const [stackName] = ctx.args;
  const root = typeof ctx.flags.root === 'string' ? ctx.flags.root : null;
  if (!stackName || !root) return fail('usage: gitq track <stackName> --root <branch>');
  const store = await loadStore(ctx.repoRoot);
  if (store.stacks.some((s) => s.stackName === stackName)) return fail(`stack ${stackName} already exists`);
  const stack = StackManager.createStack(stackName, root);
  await updateStore(ctx.repoRoot, (fresh) => ({ ...fresh, stacks: [...fresh.stacks, stack] }));
  emit(ctx, `tracked ${stackName} (root ${root})`, { stack });
  return 0;
}

export async function untrackCommand(ctx: CliContext): Promise<number> {
  const [stackName] = ctx.args;
  if (!stackName) return fail('usage: gitq untrack <stackName>');
  const store = await loadStore(ctx.repoRoot);
  const stack = store.stacks.find((s) => s.stackName === stackName);
  if (!stack) {
    return fail(`no stack named ${stackName} (have: ${store.stacks.map((s) => s.stackName).join(', ') || 'none'})`);
  }
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;
  await updateStore(ctx.repoRoot, (fresh) => ({
    ...fresh,
    stacks: fresh.stacks.filter((s) => s.stackName !== stackName),
  }));
  emit(ctx, `untracked ${stackName}`, { removed: stackName });
  return 0;
}

export async function addCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  const parent = typeof ctx.flags.parent === 'string' ? ctx.flags.parent : null;
  if (!branch || !parent) return fail('usage: gitq add <branch> --parent <branch> [--stack <name>]');
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, parent);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;
  const updated = StackManager.addNode(stack, branch, parent);
  await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, updated));
  emit(ctx, `added ${branch} under ${parent}`, { stack: updated });
  return 0;
}

export async function removeCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  if (!branch) return fail('usage: gitq remove <branch> [--stack <name>]');
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStackVia(store, ctx.flags, branch);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null) return guarded;
  const updated = StackManager.removeNode(stack, branch);
  await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, updated));
  emit(ctx, `removed ${branch}`, { stack: updated });
  return 0;
}
