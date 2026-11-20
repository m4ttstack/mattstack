import { describe, expect, test } from 'bun:test';
import type { GitProvider, UpdatePullRequestInput } from '@mattstack/glance';
import { closeFoldedRemote, foldLeftovers } from '../src/core/fold-remote.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import type { Stack } from '../src/core/types.ts';

/** main -> a -> b(!5) -> c(!6), with b about to be folded into a. */
function stackBeforeFold(): Stack {
  let stack = StackManager.createStack('s', 'main');
  stack = StackManager.addNode(stack, 'a', 'main');
  stack = StackManager.addNode(stack, 'b', 'a');
  stack = StackManager.updateNode(stack, 'b', { mrIid: 5, mrUrl: 'https://x/5', status: 'synced' });
  stack = StackManager.addNode(stack, 'c', 'b');
  stack = StackManager.updateNode(stack, 'c', { mrIid: 6, mrUrl: 'https://x/6', status: 'synced' });
  return stack;
}

function stackAfterFold(): Stack {
  return StackManager.removeNode(StackManager.moveNode(stackBeforeFold(), 'c', 'a'), 'b');
}

type Call = string;

function recordingProvider(calls: Call[], fail: Partial<Record<'update' | 'delete', string>> = {}): GitProvider {
  return {
    providerName: 'gitlab',
    updatePullRequest: async (_project: string, iid: number, input: UpdatePullRequestInput) => {
      if (fail.update) throw new Error(fail.update);
      calls.push(input.stateEvent ? `close !${iid}` : `retarget !${iid} -> ${input.targetBranch}`);
      return {} as never;
    },
    deleteBranch: async (_project: string, branch: string) => {
      if (fail.delete) throw new Error(fail.delete);
      calls.push(`delete ${branch}`);
    },
  } as unknown as GitProvider;
}

describe('foldLeftovers', () => {
  test('names the open MR and the remote branch a fold leaves behind', () => {
    expect(foldLeftovers(stackBeforeFold(), 'b', true)).toEqual({
      branch: 'b',
      mrIid: 5,
      mrUrl: 'https://x/5',
      remoteBranch: true,
    });
  });

  test('a merged MR is not a leftover', () => {
    const stack = StackManager.updateNode(stackBeforeFold(), 'b', { status: 'merged' });
    expect(foldLeftovers(stack, 'b', false)).toBeNull();
  });

  test('a local-only branch with no remote leaves nothing', () => {
    let stack = StackManager.createStack('s', 'main');
    stack = StackManager.addNode(stack, 'b', 'main');
    expect(foldLeftovers(stack, 'b', false)).toBeNull();
  });
});

describe('closeFoldedRemote', () => {
  test('retargets the children, then closes the MR, then deletes the remote branch', async () => {
    const calls: Call[] = [];
    const leftovers = foldLeftovers(stackBeforeFold(), 'b', true)!;

    const result = await closeFoldedRemote(recordingProvider(calls), stackAfterFold(), leftovers, ['c'], 'acme/app');

    expect(calls).toEqual(['retarget !6 -> a', 'close !5', 'delete b']);
    expect(result.steps.every((s) => s.success)).toBe(true);
  });

  test('finds and retargets a child MR gitq never recorded before deleting the branch', async () => {
    const calls: Call[] = [];
    const stack = StackManager.updateNode(stackAfterFold(), 'c', { mrIid: null, mrUrl: null, status: 'local-only' });
    const leftovers = foldLeftovers(stackBeforeFold(), 'b', true)!;
    const provider = {
      ...recordingProvider(calls),
      fetchPullRequestsByBranches: async (_project: string, branches: string[]) =>
        new Map(branches.map((b) => [b, b === 'c' ? { iid: 6, sourceBranch: 'c', targetBranch: 'b', webUrl: 'https://x/6' } : null])),
    } as unknown as GitProvider;

    await closeFoldedRemote(provider, stack, leftovers, ['c'], 'acme/app');

    expect(calls).toEqual(['retarget !6 -> a', 'close !5', 'delete b']);
  });

  test('keeps the remote branch when a child with no recorded MR cannot be looked up', async () => {
    const calls: Call[] = [];
    const stack = StackManager.updateNode(stackAfterFold(), 'c', { mrIid: null, mrUrl: null, status: 'local-only' });
    const leftovers = foldLeftovers(stackBeforeFold(), 'b', true)!;
    const provider = {
      ...recordingProvider(calls),
      fetchPullRequestsByBranches: async () => {
        throw new Error('502');
      },
    } as unknown as GitProvider;

    const result = await closeFoldedRemote(provider, stack, leftovers, ['c'], 'acme/app');

    expect(calls).toEqual(['close !5']);
    expect(result.steps).toContainEqual({ step: 'retarget', target: 'c', success: false, error: '502' });
    expect(result.steps).toContainEqual({ step: 'delete', target: 'b', success: false, error: 'kept: a child MR still targets it' });
  });

  test('keeps the remote branch when a child could not be retargeted', async () => {
    const calls: Call[] = [];
    const leftovers = foldLeftovers(stackBeforeFold(), 'b', true)!;

    const result = await closeFoldedRemote(
      recordingProvider(calls, { update: 'forbidden' }),
      stackAfterFold(),
      leftovers,
      ['c'],
      'acme/app',
    );

    expect(calls).toEqual([]);
    expect(result.steps).toEqual([
      { step: 'retarget', target: 'c', success: false, error: 'forbidden' },
      { step: 'close', target: 'b', success: false, error: 'forbidden' },
      { step: 'delete', target: 'b', success: false, error: 'kept: a child MR still targets it' },
    ]);
  });
});
