import type { GitProvider } from '@mattstack/glance';
import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { ForgeSync } from './forge-sync.ts';
import { toErrorMessage } from './error-utils.ts';

/** What a local fold leaves open on the forge for the folded branch. */
export interface FoldLeftovers {
  branch: string;
  /** The folded branch's MR while it is still open; null when it has none or it merged. */
  mrIid: number | null;
  mrUrl: string | null;
  /** Whether origin still has the folded branch. */
  remoteBranch: boolean;
}

export interface FoldRemoteStep {
  step: 'retarget' | 'close' | 'delete';
  /** The branch the step acted on: a child for retarget, the folded branch otherwise. */
  target: string;
  success: boolean;
  error?: string;
}

/** Read from the stack as it was before the fold, while the folded node is still in it. */
export function foldLeftovers(stackBefore: Stack, branch: string, remoteBranch: boolean): FoldLeftovers | null {
  const node = StackManager.findNode(stackBefore, branch);
  const openMr = node && node.mrIid !== null && node.status !== 'merged' ? node : null;
  if (!openMr && !remoteBranch) return null;
  return { branch, mrIid: openMr?.mrIid ?? null, mrUrl: openMr?.mrUrl ?? null, remoteBranch };
}

/**
 * Close what a fold left on the forge. Children's MRs are retargeted first: a
 * forge can close an MR whose target branch is deleted, so the remote branch
 * is kept while any child MR could still point at it.
 */
export async function closeFoldedRemote(
  provider: GitProvider,
  stackAfter: Stack,
  leftovers: FoldLeftovers,
  reParentedChildren: string[],
  projectPath: string,
): Promise<{ stack: Stack; steps: FoldRemoteStep[] }> {
  const steps: FoldRemoteStep[] = [];
  let stack = stackAfter;

  for (const child of reParentedChildren) {
    const node = StackManager.findNode(stack, child);
    if (!node || node.mrIid === null || node.status === 'merged') continue;
    try {
      stack = await ForgeSync.retargetMR(provider, stack, child, projectPath);
      steps.push({ step: 'retarget', target: child, success: true });
    } catch (err) {
      steps.push({ step: 'retarget', target: child, success: false, error: toErrorMessage(err) });
    }
  }

  if (leftovers.mrIid !== null) {
    try {
      await provider.updatePullRequest(projectPath, leftovers.mrIid, { stateEvent: 'close' });
      steps.push({ step: 'close', target: leftovers.branch, success: true });
    } catch (err) {
      steps.push({ step: 'close', target: leftovers.branch, success: false, error: toErrorMessage(err) });
    }
  }

  if (leftovers.remoteBranch) {
    if (steps.some((s) => s.step === 'retarget' && !s.success)) {
      steps.push({ step: 'delete', target: leftovers.branch, success: false, error: 'kept: a child MR still targets it' });
    } else {
      try {
        await provider.deleteBranch(projectPath, leftovers.branch);
        steps.push({ step: 'delete', target: leftovers.branch, success: true });
      } catch (err) {
        steps.push({ step: 'delete', target: leftovers.branch, success: false, error: toErrorMessage(err) });
      }
    }
  }

  return { stack, steps };
}
