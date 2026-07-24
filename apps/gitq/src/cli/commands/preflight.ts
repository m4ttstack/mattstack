import { loadStore } from '../../core/persistence.ts';
import { RebaseEngine } from '../../core/rebase-engine.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';

export async function preflightCommand(ctx: CliContext): Promise<number> {
  const store = await loadStore(ctx.repoRoot);
  const stacks = [];
  for (const stack of store.stacks) {
    const branches = stack.nodes.map((n) => n.branch);
    const report = await RebaseEngine.preflight(ctx.repoRoot, stack, branches);
    stacks.push({ stackName: stack.stackName, report });
  }
  const human = stacks
    .map((s) => {
      const conflicts = s.report.conflictBranches
        .map((c) => `  ${c.branch}: ${c.files.map((f) => `${f.type} ${f.file}`).join(', ')}`)
        .join('\n');
      return `${s.stackName}: dirty=${s.report.dirty}\n${conflicts || '  no predicted conflicts'}`;
    })
    .join('\n');
  emit(ctx, human || 'no stacks', { stacks });
  return 0;
}
