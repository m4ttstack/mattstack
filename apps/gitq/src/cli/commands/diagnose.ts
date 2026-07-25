import { loadStore } from '../../core/persistence.ts';
import { collectSnapshot, diagnoseStack, type NodeDirective } from '../../core/stack-diagnostics.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';
import { worktreesForJson } from '../slots.ts';

export async function diagnoseCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const stacks = [];
  for (const stack of store.stacks) {
    const snapshot = await collectSnapshot(ctx.repoRoot, stack);
    const diagnostics = diagnoseStack(snapshot, stack);
    // diagnostics.nodes is a Map (keyed by branch) — flatten to an array so it
    // survives JSON.stringify and matches the { stacks: [...] } contract.
    const nodes = Array.from(diagnostics.nodes.values()).map((n: NodeDirective) => ({
      ...n,
      checkedOutIn: worktrees.find((w) => !w.isWorkSlot && w.branch === n.branch)?.name ?? null,
    }));
    stacks.push({
      stackName: stack.stackName,
      diagnostics: {
        nodes,
        edges: diagnostics.edges,
        banner: diagnostics.banner,
        globalBlocks: diagnostics.globalBlocks,
      },
    });
  }
  const human = stacks
    .map((s) => `${s.stackName}:\n` + s.diagnostics.nodes
      .map((n) => `  ${n.branch}: ${n.situation}${n.checkedOutIn ? ` [in ${n.checkedOutIn}]` : ''}`).join('\n'))
    .join('\n');
  emit(ctx, human || 'no stacks', { stacks, worktrees });
  return 0;
}
