import type { GitProvider } from '@mattstack/glance';
import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { ForgeSync, findOpenChangesByBranch, type OpenChangeLookup } from './forge-sync.ts';
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

  // A child with no recorded MR can still have an open one targeting the
  // folded branch, so it is looked up before the branch can be deleted.
  const unrecorded = reParentedChildren.filter((child) => {
    const node = StackManager.findNode(stack, child);
    return node !== undefined && node.mrIid === null && node.status !== 'merged';
  });
  let lookup: OpenChangeLookup = { byBranch: new Map(), incomplete: new Map() };
  let lookupError: string | null = null;
  try {
    lookup = await findOpenChangesByBranch(provider, projectPath, unrecorded);
  } catch (err) {
    lookupError = toErrorMessage(err);
  }
  for (const child of unrecorded) {
    const problem = lookupError ?? lookup.incomplete.get(child);
    if (problem !== undefined) {
      steps.push({ step: 'retarget', target: child, success: false, error: problem });
      continue;
    }
    const pr = lookup.byBranch.get(child);
    if (pr) {
      stack = StackManager.updateNode(stack, child, { mrIid: pr.iid, mrUrl: pr.webUrl, mrTitle: pr.title, status: 'synced' });
    }
  }

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
