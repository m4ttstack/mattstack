import { OperationLog, entryBelongsToRepo } from '../../core/operation-log.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';

export async function logCommand(ctx: CliContext): Promise<number> {
  // The log is a single global file (per GITQ_CONFIG_DIR). Show only entries
  // for this repo; count (but don't list) entries that belong to other repos.
  const all = await OperationLog.load();
  const entries = all.filter((e) => entryBelongsToRepo(e, ctx.repoRoot));
  const otherRepoCount = all.length - entries.length;

  const lines = entries.map((e) => {
    const branches = Object.keys(e.branchSnapshots).join(', ') || 'no branches';
    return `${new Date(e.timestamp).toISOString()} ${e.operation} (${branches})`;
  });
  let human = lines.join('\n') || 'no operations';
  if (otherRepoCount > 0) {
    human += `\n(${otherRepoCount} operation(s) from other repos hidden)`;
  }
  emit(ctx, human, { entries, otherRepoCount });
  return 0;
}
