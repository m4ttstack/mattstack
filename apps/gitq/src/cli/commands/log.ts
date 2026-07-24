import { OperationLog } from '../../core/operation-log.ts';
import type { CliContext } from '../context.ts';
import { emit } from '../output.ts';

export async function logCommand(ctx: CliContext): Promise<number> {
  // OperationLog.load() takes no args — the log is a single global file
  // (per GITQ_CONFIG_DIR), not scoped per repo.
  const entries = await OperationLog.load();
  const human = entries
    .map((e) => {
      const branches = Object.keys(e.branchSnapshots).join(', ') || 'no branches';
      return `${new Date(e.timestamp).toISOString()} ${e.operation} (${branches})`;
    })
    .join('\n');
  emit(ctx, human || 'no operations', { entries });
  return 0;
}
