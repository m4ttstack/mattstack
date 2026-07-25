import { GitShell, setCommandHook } from '../core/git-shell.ts';
import { OperationLog, type OperationType } from '../core/operation-log.ts';
import type { Stack } from '../core/types.ts';
import type { CliContext } from './context.ts';

/**
 * Snapshot the current git HEAD of every branch in the stack (root + nodes)
 * before a mutating command runs. Best-effort: a branch that doesn't resolve
 * (e.g. not yet created) is simply omitted.
 */
async function snapshotBranches(cwd: string, stack: Stack): Promise<Record<string, string>> {
  const snapshots: Record<string, string> = {};
  const branches = new Set<string>([stack.root, ...stack.nodes.map((n) => n.branch)]);
  for (const branch of branches) {
    try {
      snapshots[branch] = await GitShell.getBranchHead(cwd, branch);
    } catch {
      /* best-effort — branch may not exist */
    }
  }
  return snapshots;
}

/**
 * Record an operation-log entry around a mutating command.
 *
 * Snapshots the stack's branch heads BEFORE running `fn`, installs the GitShell
 * command hook so every git invocation `fn` makes is captured, then persists the
 * entry once `fn` resolves — but only when `shouldLog(exitCode)` is true
 * (default: a clean exit `0`). A thrown `fn` never logs. This is the piece that
 * makes `gitq undo`/`gitq log` reflect real operations; without it both are inert.
 *
 * The entry is scoped to `ctx.repoRoot` so it's only visible/undoable in the
 * repo it ran in.
 */
export async function withOperationLog(
  ctx: CliContext,
  stack: Stack,
  operation: OperationType,
  fn: () => Promise<number>,
  shouldLog: (exitCode: number) => boolean = (code) => code === 0,
): Promise<number> {
  const snapshots = await snapshotBranches(ctx.repoRoot, stack);
  const entry = { ...OperationLog.create(operation, stack, snapshots, ctx.repoRoot), commonDir: ctx.commonDir };
  setCommandHook(OperationLog.commandHook(entry));
  let exitCode: number;
  try {
    exitCode = await fn();
  } finally {
    setCommandHook(null);
  }
  if (shouldLog(exitCode)) {
    await OperationLog.save(entry).catch(() => {});
  }
  return exitCode;
}
