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
      // Every branch gone from the remote: the stack is finished (or was
      // deleted elsewhere) and only the tracking record is left. A field, not
      // just a rendering choice, so the board can act on it too.
      allBranchesGone: nodes.length > 0 && nodes.every((n) => n.situation === 'branch-deleted-remote'),
      diagnostics: {
        nodes,
        edges: diagnostics.edges,
        banner: diagnostics.banner,
        globalBlocks: diagnostics.globalBlocks,
      },
    });
  }
  // A dead stack collapses to its one actionable line. Listing every branch
  // says the same thing N times and pushes the live stacks down the screen;
  // at six tracked stacks the dead ones were a quarter of the output.
  // Collapsed rather than hidden: a tracked stack nobody sees is one nobody
  // remembers to untrack, which is how they accumulated in the first place.
  const human = stacks
    .map((s) => s.allBranchesGone
      ? `${s.stackName}: all ${s.diagnostics.nodes.length} branches gone from the remote — gitq untrack ${s.stackName}`
      : `${s.stackName}:\n` + s.diagnostics.nodes
        .map((n) => `  ${n.branch}: ${n.situation}${n.checkedOutIn ? ` [in ${n.checkedOutIn}]` : ''}`).join('\n'))
    .join('\n');
  emit(ctx, human || 'no stacks', { stacks, worktrees });
  return 0;
}
