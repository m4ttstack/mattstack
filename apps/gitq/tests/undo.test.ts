import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { restoreMockedModulesAfterAll } from './module-restore.ts';
import { GitShell as RealGitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';
import type { OperationEntry } from '../src/core/operation-log.ts';

restoreMockedModulesAfterAll();

// Mock GitShell
const gitShellCalls: { method: string; args: unknown[] }[] = [];

mock.module('../src/core/git-shell.ts', () => ({
  GitShell: {
    ...RealGitShell,
    getCurrentBranch: async () => {
      gitShellCalls.push({ method: 'getCurrentBranch', args: [] });
      return 'main';
    },
    branchExists: async (_cwd: string, branch: string) => {
      gitShellCalls.push({ method: 'branchExists', args: [branch] });
      return true;
    },
    checkoutBranch: async (_cwd: string, branch: string) => {
      gitShellCalls.push({ method: 'checkoutBranch', args: [branch] });
    },
    resetHard: async (_cwd: string, ref: string) => {
      gitShellCalls.push({ method: 'resetHard', args: [ref] });
    },
  },
}));

import { canUndo, undo } from '../src/core/undo.ts';

function makeStack(id = 'test-stack'): Stack {
  return {
    id,
    stackName: 'test-stack',
    root: 'main',
    nodes: [
      {
        branch: 'feat/a',
        parent: 'main',
        mrIid: null,
        mrUrl: null,
        mrTitle: null,
        status: 'local-only',
        lastKnownHead: 'sha-a',
        forkPoint: null,
        diffStats: null,
        pipelineStatus: 'unknown',
        unresolvedThreads: 0,
      },
      {
        branch: 'feat/b',
        parent: 'feat/a',
        mrIid: null,
        mrUrl: null,
        mrTitle: null,
        status: 'local-only',
        lastKnownHead: 'sha-b',
        forkPoint: null,
        diffStats: null,
        pipelineStatus: 'unknown',
        unresolvedThreads: 0,
      },
    ],
  };
}

function makeEntry(
  operation: OperationEntry['operation'],
  branchSnapshots: Record<string, string> = {},
): OperationEntry {
  return {
    id: 'entry-1',
    timestamp: Date.now(),
    operation,
    commands: [],
    branchSnapshots,
    stackSnapshot: makeStack(),
  };
}

beforeEach(() => {
  gitShellCalls.length = 0;
});

describe('canUndo', () => {
  test('returns true for reversible operations', () => {
    expect(canUndo(makeEntry('cascade-rebase'))).toBe(true);
    expect(canUndo(makeEntry('reparent'))).toBe(true);
    expect(canUndo(makeEntry('absorb'))).toBe(true);
    expect(canUndo(makeEntry('sync'))).toBe(true);
  });

  test('returns false for non-reversible operations', () => {
    expect(canUndo(makeEntry('fold'))).toBe(false);
    expect(canUndo(makeEntry('split'))).toBe(false);
  });
});

describe('undo', () => {
  test('resets branches to snapshot SHAs', async () => {
    const entry = makeEntry('cascade-rebase', {
      'feat/a': 'sha-pre-a',
      'feat/b': 'sha-pre-b',
    });

    const result = await undo('/repo', entry);

    expect(result.success).toBe(true);
    expect(result.restoredBranches).toEqual(['feat/a', 'feat/b']);

    const checkouts = gitShellCalls.filter((c) => c.method === 'checkoutBranch');
    const resets = gitShellCalls.filter((c) => c.method === 'resetHard');
    expect(checkouts).toHaveLength(3); // 2 branches + return to original
    expect(resets).toHaveLength(2);
    expect(resets[0]!.args[0]).toBe('sha-pre-a');
    expect(resets[1]!.args[0]).toBe('sha-pre-b');
  });

  test('restores the stack tree from snapshot', async () => {
    const entry = makeEntry('reparent', { 'feat/a': 'sha-1' });
    const result = await undo('/repo', entry);

    expect(result.success).toBe(true);
    expect(result.restoredStack).toEqual(makeStack());
    expect(result.restoredStack.nodes).toHaveLength(2);
  });

  test('returns error for non-reversible operations', async () => {
    const entry = makeEntry('fold', { 'feat/a': 'sha-1' });
    const result = await undo('/repo', entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not reversible');
    expect(gitShellCalls).toHaveLength(0);
  });

  test('returns error when no branch snapshots exist', async () => {
    const entry = makeEntry('cascade-rebase', {});
    const result = await undo('/repo', entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No branch snapshots');
  });

  test('returns stack snapshot even on failure', async () => {
    const entry = makeEntry('fold');
    const result = await undo('/repo', entry);

    expect(result.restoredStack).toEqual(makeStack());
  });
});
