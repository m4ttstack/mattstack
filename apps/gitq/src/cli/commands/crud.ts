import { StackManager } from '../../core/stack-manager.ts';
import { loadStore, saveStore } from '../../core/persistence.ts';
import type { Stack, StackStore } from '../../core/types.ts';
import type { CliContext } from '../context.ts';
import { emit, fail } from '../output.ts';
import { requireNoPause } from '../pause-file.ts';

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
  await saveStore(ctx.repoRoot, { ...store, stacks: [...store.stacks, stack] });
  emit(ctx, `tracked ${stackName} (root ${root})`, { stack });
  return 0;
}

export async function untrackCommand(ctx: CliContext): Promise<number> {
  const [stackName] = ctx.args;
  if (!stackName) return fail('usage: gitq untrack <stackName>');
  const paused = await requireNoPause(ctx);
  if (paused !== null) return paused;
  const store = await loadStore(ctx.repoRoot);
  if (!store.stacks.some((s) => s.stackName === stackName)) {
    return fail(`no stack named ${stackName} (have: ${store.stacks.map((s) => s.stackName).join(', ') || 'none'})`);
  }
  await saveStore(ctx.repoRoot, { ...store, stacks: store.stacks.filter((s) => s.stackName !== stackName) });
  emit(ctx, `untracked ${stackName}`, { removed: stackName });
  return 0;
}

export async function addCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  const parent = typeof ctx.flags.parent === 'string' ? ctx.flags.parent : null;
  if (!branch || !parent) return fail('usage: gitq add <branch> --parent <branch> [--stack <name>]');
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const updated = StackManager.addNode(stack, branch, parent);
  await saveStore(ctx.repoRoot, replaceStack(store, updated));
  emit(ctx, `added ${branch} under ${parent}`, { stack: updated });
  return 0;
}

export async function removeCommand(ctx: CliContext): Promise<number> {
  const [branch] = ctx.args;
  if (!branch) return fail('usage: gitq remove <branch> [--stack <name>]');
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const updated = StackManager.removeNode(stack, branch);
  await saveStore(ctx.repoRoot, replaceStack(store, updated));
  emit(ctx, `removed ${branch}`, { stack: updated });
  return 0;
}
