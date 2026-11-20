import { describe, expect, test } from 'bun:test';
import { formatStackLine } from '../src/cli/commands/stacks.ts';
import { StackManager } from '../src/core/stack-manager.ts';

describe('formatStackLine', () => {
  test('prints a chain in parent order, not the order branches were added', () => {
    let stack = StackManager.createStack('s', 'main');
    stack = StackManager.addNode(stack, 'a', 'main');
    stack = StackManager.addNode(stack, 'platform', 'a');
    stack = StackManager.addNode(stack, 'emma', 'a');
    stack = StackManager.moveNode(stack, 'platform', 'emma');

    expect(formatStackLine(stack)).toBe('s (root main): a -> emma -> platform');
  });

  test('starts each fork after the first with its parent', () => {
    let stack = StackManager.createStack('s', 'main');
    stack = StackManager.addNode(stack, 'a', 'main');
    stack = StackManager.addNode(stack, 'b', 'a');
    stack = StackManager.addNode(stack, 'c', 'a');
    stack = StackManager.addNode(stack, 'd', 'main');

    expect(formatStackLine(stack)).toBe('s (root main): a -> b; a -> c; main -> d');
  });

  test('says empty for a stack with no branches', () => {
    expect(formatStackLine(StackManager.createStack('s', 'main'))).toBe('s (root main): empty');
  });
});
