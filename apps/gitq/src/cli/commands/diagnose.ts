import { loadStore } from '../../core/persistence.ts';
import { collectSnapshot, diagnoseStack, type NodeDirective } from '../../core/stack-diagnostics.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';

export async function diagnoseCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const stacks = [];
  for (const stack of store.stacks) {
    const snapshot = await collectSnapshot(ctx.repoRoot, stack);
    const diagnostics = diagnoseStack(snapshot, stack);
    // diagnostics.nodes is a Map (keyed by branch) — flatten to an array so it
    // survives JSON.stringify and matches the { stacks: [...] } contract.
    const nodes: NodeDirective[] = Array.from(diagnostics.nodes.values());
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
      .map((n) => `  ${n.branch}: ${n.situation}`).join('\n'))
    .join('\n');
  emit(ctx, human || 'no stacks', { stacks });
  return 0;
}
