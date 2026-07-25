import { loadStore } from '../../core/persistence.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';
import { worktreesForJson } from '../slots.ts';

export async function stacksCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const human = store.stacks.length === 0
    ? 'no stacks'
    : store.stacks
        .map((s) => `${s.stackName} (root ${s.root}): ${s.nodes.map((n) => n.branch).join(' -> ') || 'empty'}`)
        .join('\n');
  emit(ctx, human, { stacks: store.stacks, worktrees });
  return 0;
}
