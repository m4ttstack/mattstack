import { loadStore } from '../../core/persistence.ts';
import { StackManager } from '../../core/stack-manager.ts';
import type { Stack } from '../../core/types.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';
import { worktreesForJson } from '../slots.ts';

/**
 * One stack as a line of `parent -> child` chains in tree order. A chain
 * continues through a branch's first child; every later child starts a new
 * chain that names its parent, so a fork reads as `a -> b; a -> c`.
 */
export function formatStackLine(stack: Stack): string {
  const chains: string[][] = [];
  const seen = new Set<string>();

  const walk = (branch: string, chain: string[] | null): void => {
    StackManager.getChildren(stack, branch).forEach((child, i) => {
      if (seen.has(child.branch)) return;
      seen.add(child.branch);
      let current = i === 0 ? chain : null;
      if (!current) {
        current = branch === stack.root && chains.length === 0 ? [] : [branch];
        chains.push(current);
      }
      current.push(child.branch);
      walk(child.branch, current);
    });
  };
  walk(stack.root, null);

  for (const node of stack.nodes) {
    if (!seen.has(node.branch)) chains.push([node.parent, node.branch]);
  }

  const body = chains.length === 0 ? 'empty' : chains.map((c) => c.join(' -> ')).join('; ');
  return `${stack.stackName} (root ${stack.root}): ${body}`;
}

export async function stacksCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const human = store.stacks.length === 0 ? 'no stacks' : store.stacks.map(formatStackLine).join('\n');
  emit(ctx, human, { stacks: store.stacks, worktrees });
  return 0;
}
