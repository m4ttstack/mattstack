import { loadStore } from '../../core/persistence.ts';
import { RebaseEngine } from '../../core/rebase-engine.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';
import { worktreesForJson } from '../slots.ts';

export async function preflightCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const stacks = [];
  for (const stack of store.stacks) {
    const branches = stack.nodes.map((n) => n.branch);
    const report = await RebaseEngine.preflight(ctx.repoRoot, stack, branches);
    const slotConflicts = branches.flatMap((branch) => {
      const owner = worktrees.find((w) => !w.isWorkSlot && w.branch === branch);
      return owner ? [{ branch, slot: owner.name, dirty: owner.dirty }] : [];
    });
    stacks.push({ stackName: stack.stackName, report, slotConflicts });
  }
  const human = stacks
    .map((s) => {
      const conflicts = s.report.conflictBranches
        .map((c) => `  ${c.branch}: ${c.files.map((f) => `${f.type} ${f.file}`).join(', ')}`)
        .join('\n');
      const slotConflicts = s.slotConflicts.length > 0
        ? `\nslot conflicts:\n${s.slotConflicts.map((c) => `  ${c.branch}: ${c.slot}${c.dirty ? ' (dirty)' : ''}`).join('\n')}`
        : '';
      return `${s.stackName}: dirty=${s.report.dirty}\n${conflicts || '  no predicted conflicts'}${slotConflicts}`;
    })
    .join('\n');
  emit(ctx, human || 'no stacks', { stacks, worktrees });
  return 0;
}
