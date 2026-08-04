import { GitShell } from './git-shell.ts';
import { StackManager } from './stack-manager.ts';
import type { Stack } from './types.ts';

export interface PushPlanEntry {
  branch: string;
  action: 'push' | 'current' | 'skip';
  /** Local branch head, null when git has no such branch. */
  localHead: string | null;
  /** Remote-tracking head, null when there is no `origin/<branch>` ref. */
  remoteHead: string | null;
  /** Why this node is skipped. Only set on skips. */
  detail?: string;
}

/**
 * Decide what each node needs, from heads alone.
 *
 * Pure so the node-state matrix is testable without a repo. A node with no
 * remote-tracking ref plans as a push: whether the remote actually has the
 * branch is the lease's call at push time, not something to guess from here.
 */
export function buildPushPlan(
  stack: Stack,
  localHeads: Record<string, string | undefined>,
  remoteHeads: Record<string, string | undefined>,
): PushPlanEntry[] {
  return StackManager.toposort(stack).map((node) => {
    const localHead = localHeads[node.branch] ?? null;
    const remoteHead = remoteHeads[node.branch] ?? null;
    const base = { branch: node.branch, localHead, remoteHead };

    if (node.status === 'merged') return { ...base, action: 'skip' as const, detail: 'merged' };
    if (node.mrIid === null) return { ...base, action: 'skip' as const, detail: 'no MR; use gitq publish' };
    if (localHead !== null && localHead === remoteHead) return { ...base, action: 'current' as const };
    return { ...base, action: 'push' as const };
  });
}
