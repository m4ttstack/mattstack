import { describe, expect, test } from 'bun:test';
import { pickStackForAdd } from '../src/cli/commands/crud.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import type { Stack, StackStore } from '../src/core/types.ts';

function storeOf(...stacks: Stack[]): StackStore {
  return { repoPath: '/repo', remoteUrl: '', stacks };
}

function withBranch(name: string, branch: string): Stack {
  return StackManager.addNode(StackManager.createStack(name, 'master'), branch, 'master');
}

describe('pickStackForAdd', () => {
  test('picks the only empty stack on a shared root', () => {
    const fresh = StackManager.createStack('fresh', 'master');
    const store = storeOf(withBranch('one', 'x'), withBranch('two', 'y'), fresh);

    expect(pickStackForAdd(store, {}, 'master').stackName).toBe('fresh');
  });

  test('still asks for --stack when two stacks on the root are empty', () => {
    const store = storeOf(StackManager.createStack('a', 'master'), StackManager.createStack('b', 'master'));

    expect(() => pickStackForAdd(store, {}, 'master')).toThrow('--stack required');
  });

  test('picks the stack that owns a node parent', () => {
    const store = storeOf(withBranch('one', 'x'), withBranch('two', 'y'), StackManager.createStack('fresh', 'master'));

    expect(pickStackForAdd(store, {}, 'y').stackName).toBe('two');
  });

  test('--stack wins over inference', () => {
    const store = storeOf(withBranch('one', 'x'), StackManager.createStack('fresh', 'master'));

    expect(pickStackForAdd(store, { stack: 'one' }, 'master').stackName).toBe('one');
  });
});
