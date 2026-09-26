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

export interface PushNodeResult {
  branch: string;
  action: 'pushed' | 'current' | 'skipped' | 'failed';
  /** Remote head before this run, null when there was no remote-tracking ref. */
  before: string | null;
  /** Local head, which is what the remote carries after a successful push. */
  after: string | null;
  detail?: string;
  error?: string;
}

export interface PushResult {
  results: PushNodeResult[];
}

/**
 * git's rejection wording, turned into the one thing the human can act on.
 *
 * A lease rejection means the remote-tracking ref no longer describes the
 * remote, so the fix is a fetch, not a bigger hammer.
 */
function pushErrorMessage(err: unknown): string {
  const stderr = typeof err === 'object' && err !== null ? String((err as { stderr?: string }).stderr ?? '') : '';
  if (/stale info|fetch first|rejected|non-fast-forward/i.test(stderr)) {
    return 'remote moved since last fetch; run gitq sync';
  }
  return err instanceof Error ? err.message : String(err);
}

export const ForgePush = {
  /** Resolve every node's local and remote-tracking head, then plan. */
  async planPush(cwd: string, stack: Stack): Promise<PushPlanEntry[]> {
    const localHeads: Record<string, string> = {};
    const remoteHeads: Record<string, string> = {};
    for (const node of stack.nodes) {
      try {
        localHeads[node.branch] = await GitShell.getBranchHead(cwd, node.branch);
      } catch {
        // A branch git no longer has plans as a push and fails there, carrying
        // git's own message, rather than being silently dropped here.
      }
      try {
        remoteHeads[node.branch] = await GitShell.getBranchHead(cwd, `origin/${node.branch}`);
      } catch {
        // No remote-tracking ref. The lease decides at push time.
      }
    }
    return buildPushPlan(stack, localHeads, remoteHeads);
  },

  /**
   * Push every published branch whose remote-tracking ref is behind its local
   * head.
   *
   * Deliberately never fetches: `--force-with-lease` compares against the
   * remote-tracking ref, so refreshing it first would bless a push made by
   * someone else between their push and ours, which is the whole thing the
   * lease exists to catch.
   *
   * One rejection fails that branch and the walk continues. Unlike publish,
   * where a failed create leaves children with no base to target, each branch
   * here is independent.
   */
  async pushStack(cwd: string, stack: Stack): Promise<PushResult> {
    const plan = await ForgePush.planPush(cwd, stack);
    const results: PushNodeResult[] = [];

    for (const entry of plan) {
      const base = { branch: entry.branch, before: entry.remoteHead, after: entry.localHead };
      if (entry.action === 'skip') {
        results.push({ ...base, action: 'skipped', detail: entry.detail });
        continue;
      }
      if (entry.action === 'current') {
        results.push({ ...base, action: 'current' });
        continue;
      }
      try {
        await GitShell.pushForceWithLease(cwd, entry.branch);
        results.push({ ...base, action: 'pushed' });
      } catch (err) {
        results.push({ ...base, action: 'failed', error: pushErrorMessage(err) });
      }
    }

    return { results };
  },
};
