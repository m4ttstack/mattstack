import { describe, test, expect } from 'bun:test';
import { buildPushPlan } from '../src/core/push.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import type { Stack } from '../src/core/types.ts';

/** main -> a -> b, both published and synced. */
function twoNodeStack(): Stack {
  let stack = StackManager.createStack('demo', 'main');
  stack = StackManager.addNode(stack, 'a', 'main');
  stack = StackManager.addNode(stack, 'b', 'a');
  stack = StackManager.updateNode(stack, 'a', { mrIid: 1, status: 'synced' });
  stack = StackManager.updateNode(stack, 'b', { mrIid: 2, status: 'synced' });
  return stack;
}

describe('buildPushPlan', () => {
  test('plans a push for a published branch whose remote is behind', () => {
    const plan = buildPushPlan(twoNodeStack(), { a: 'local-a', b: 'local-b' }, { a: 'remote-a', b: 'remote-b' });
    expect(plan.map((e) => e.action)).toEqual(['push', 'push']);
    expect(plan[0]).toMatchObject({ branch: 'a', action: 'push', localHead: 'local-a', remoteHead: 'remote-a' });
  });

  test('a branch whose remote already matches is current, not pushed', () => {
    const plan = buildPushPlan(twoNodeStack(), { a: 'same', b: 'local-b' }, { a: 'same', b: 'remote-b' });
    expect(plan.find((e) => e.branch === 'a')?.action).toBe('current');
    expect(plan.find((e) => e.branch === 'b')?.action).toBe('push');
  });

  test('a merged node is skipped even though it has an MR', () => {
    let stack = twoNodeStack();
    stack = StackManager.updateNode(stack, 'a', { status: 'merged' });
    const plan = buildPushPlan(stack, { a: 'local-a', b: 'local-b' }, { a: 'remote-a', b: 'remote-b' });
    expect(plan.find((e) => e.branch === 'a')).toMatchObject({ action: 'skip', detail: 'merged' });
  });

  test('a node with no MR is skipped and points at publish', () => {
    let stack = twoNodeStack();
    stack = StackManager.updateNode(stack, 'b', { mrIid: null, status: 'local-only' });
    const entry = buildPushPlan(stack, { a: 'x', b: 'y' }, { a: 'z' }).find((e) => e.branch === 'b');
    expect(entry?.action).toBe('skip');
    expect(entry?.detail).toContain('gitq publish');
  });

  test('a published branch with no remote-tracking ref is still planned as a push', () => {
    const plan = buildPushPlan(twoNodeStack(), { a: 'local-a', b: 'local-b' }, {});
    expect(plan.every((e) => e.action === 'push')).toBe(true);
    expect(plan[0]?.remoteHead).toBeNull();
  });

  test('entries come back in topological order, parents first', () => {
    const plan = buildPushPlan(twoNodeStack(), { a: 'x', b: 'y' }, {});
    expect(plan.map((e) => e.branch)).toEqual(['a', 'b']);
  });
});
