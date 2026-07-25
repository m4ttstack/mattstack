import { afterAll, describe, expect, test, mock, beforeEach } from 'bun:test';
import { BranchSplitter } from '../src/core/branch-splitter.ts';
import { StackManager } from '../src/core/stack-manager.ts';
import { GitShell } from '../src/core/git-shell.ts';
import type { Stack } from '../src/core/types.ts';

// Clean up all module mocks after this file's tests run.
afterAll(() => mock.restore());

/** Build a test stack with a branch that has multiple commits. */
function buildTestStack(): Stack {
  let stack = StackManager.createStack('feature', 'main');
  stack = StackManager.addNode(stack, 'feat/big-branch', 'main');
  stack = StackManager.updateNode(stack, 'feat/big-branch', { lastKnownHead: 'commit-5' });
  return stack;
}

/** Build a stack where the source branch already has children. */
function buildStackWithChildren(): Stack {
  let stack = buildTestStack();
  stack = StackManager.addNode(stack, 'feat/child-a', 'feat/big-branch');
  stack = StackManager.updateNode(stack, 'feat/child-a', { lastKnownHead: 'child-head' });
  return stack;
}

// ── tailSplit ────────────────────────────────────────────────────────────────

describe('BranchSplitter.tailSplit', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('creates new branch at source HEAD and CAS-rewinds source to the split point', async () => {
    const branchAtCalls: { name: string; from: string }[] = [];
    const updateRefCasCalls: { branch: string; newSha: string; oldSha: string }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        worktreeList: mock(() => Promise.resolve([])),
        getBranchHead: mock((_, branch: string) => {
          if (branch === 'feat/big-branch') return Promise.resolve('commit-5');
          return Promise.resolve('commit-3');
        }),
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'commit-5', subject: 'Fifth commit' },
            { sha: 'commit-4', subject: 'Fourth commit' },
            { sha: 'commit-3', subject: 'Third commit' },
            { sha: 'commit-2', subject: 'Second commit' },
            { sha: 'commit-1', subject: 'First commit' },
          ]),
        ),
        branchAt: mock((_: string, name: string, from: string) => {
          branchAtCalls.push({ name, from });
          return Promise.resolve();
        }),
        updateRefCas: mock((_: string, branch: string, newSha: string, oldSha: string) => {
          updateRefCasCalls.push({ branch, newSha, oldSha });
          return Promise.resolve();
        }),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildTestStack();
    const result = await BS.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/split-tail', 'commit-3');

    // New branch was created at source HEAD, ref-only (no checkout)
    expect(branchAtCalls).toHaveLength(1);
    expect(branchAtCalls[0]!.name).toBe('feat/split-tail');
    expect(branchAtCalls[0]!.from).toBe('commit-5');

    // Source was CAS-rewound to the split point
    expect(updateRefCasCalls).toHaveLength(1);
    expect(updateRefCasCalls[0]!.branch).toBe('feat/big-branch');
    expect(updateRefCasCalls[0]!.oldSha).toBe('commit-5');
    expect(updateRefCasCalls[0]!.newSha).toBe('commit-3');

    // Result has correct structure
    expect(result.newBranch).toBe('feat/split-tail');
    expect(result.movedCommits).toEqual(['commit-5', 'commit-4']);
  });

  test('adds new branch as child of source in stack tree', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        worktreeList: mock(() => Promise.resolve([])),
        getBranchHead: mock(() => Promise.resolve('head-sha')),
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'commit-5', subject: 'Fifth' },
            { sha: 'commit-3', subject: 'Third' },
          ]),
        ),
        branchAt: mock(() => Promise.resolve()),
        updateRefCas: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildTestStack();
    const result = await BS.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/split-tail', 'commit-3');

    // New branch is a child of source
    const newNode = StackManager.findNode(result.updatedStack, 'feat/split-tail');
    expect(newNode).toBeDefined();
    expect(newNode!.parent).toBe('feat/big-branch');
  });

  test('updates lastKnownHead on both branches', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        worktreeList: mock(() => Promise.resolve([])),
        getBranchHead: mock((_: string, branch: string) => {
          if (branch === 'feat/big-branch') return Promise.resolve('original-head');
          return Promise.resolve('reset-head');
        }),
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'original-head', subject: 'Latest' },
            { sha: 'split-point', subject: 'Split here' },
          ]),
        ),
        branchAt: mock(() => Promise.resolve()),
        updateRefCas: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildTestStack();
    const result = await BS.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/tail', 'split-point');

    // New branch gets the original source HEAD as lastKnownHead
    const newNode = StackManager.findNode(result.updatedStack, 'feat/tail');
    expect(newNode!.lastKnownHead).toBe('original-head');
  });

  test('re-parents existing children of source to new branch', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        worktreeList: mock(() => Promise.resolve([])),
        getBranchHead: mock(() => Promise.resolve('head-sha')),
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'commit-5', subject: 'Fifth' },
            { sha: 'commit-3', subject: 'Third' },
          ]),
        ),
        branchAt: mock(() => Promise.resolve()),
        updateRefCas: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildStackWithChildren();
    const result = await BS.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/tail', 'commit-3');

    // feat/child-a should now be a child of feat/tail, not feat/big-branch
    const child = StackManager.findNode(result.updatedStack, 'feat/child-a');
    expect(child!.parent).toBe('feat/tail');
  });

  test('throws if source branch not in stack', async () => {
    const stack = buildTestStack();

    await expect(BranchSplitter.tailSplit('/tmp/repo', stack, 'nonexistent', 'feat/new', 'abc')).rejects.toThrow(
      /not found in stack/,
    );
  });

  test('throws if new branch name already exists in stack', async () => {
    const stack = buildTestStack();

    await expect(
      BranchSplitter.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/big-branch', 'abc'),
    ).rejects.toThrow(/already exists/);
  });

  test('does not refuse on tree dirtiness alone (ref-only surgery, no preflight check)', async () => {
    // Old contract: any dirty cwd refused the split outright. New contract:
    // tailSplit never reads the working tree, so a dirty `cwd` that isn't
    // the branch's own checkout (no worktree owns it) does not block.
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(true)),
        hasUnstagedChanges: mock(() => Promise.resolve(true)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        worktreeList: mock(() => Promise.resolve([])),
        getBranchHead: mock(() => Promise.resolve('commit-5')),
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'commit-5', subject: 'Fifth' },
            { sha: 'commit-3', subject: 'Third' },
          ]),
        ),
        branchAt: mock(() => Promise.resolve()),
        updateRefCas: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildTestStack();

    const result = await BS.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/new', 'commit-3');
    expect(result.newBranch).toBe('feat/new');
  });

  test('throws if split point is at HEAD (no commits to move)', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getBranchHead: mock(() => Promise.resolve('commit-5')),
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'commit-5', subject: 'Fifth' },
            { sha: 'commit-4', subject: 'Fourth' },
          ]),
        ),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildTestStack();

    await expect(BS.tailSplit('/tmp/repo', stack, 'feat/big-branch', 'feat/new', 'commit-5')).rejects.toThrow(
      /No commits to split/,
    );
  });
});

// ── getCommitLog ─────────────────────────────────────────────────────────────

describe('BranchSplitter.getCommitLog', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('returns structured commit log', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        logDetailed: mock(() =>
          Promise.resolve([
            { sha: 'abc123', subject: 'Add feature X' },
            { sha: 'def456', subject: 'Fix bug Y' },
          ]),
        ),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const commits = await BS.getCommitLog('/tmp/repo', 'main');

    expect(commits).toHaveLength(2);
    expect(commits[0]!.sha).toBe('abc123');
    expect(commits[0]!.subject).toBe('Add feature X');
  });

  test('returns empty array for branch with no commits', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        logDetailed: mock(() => Promise.resolve([])),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const commits = await BS.getCommitLog('/tmp/repo', 'empty-branch');

    expect(commits).toEqual([]);
  });
});

// ── splitByFile ──────────────────────────────────────────────────────────────

function buildSplitByFileStack(): Stack {
  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat/mixed', 'main');
  stack = StackManager.updateNode(stack, 'feat/mixed', { lastKnownHead: 'mixed-head' });
  return stack;
}

describe('BranchSplitter.splitByFile', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('files matching pattern go to new branch', async () => {
    const addCalls: string[][] = [];
    const checkoutFilesCalls: { ref: string; files: string[] }[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('merge-base-sha')),
        diffNameOnly: mock(() => Promise.resolve(['api.ts', 'config.json', 'schema.sql', 'utils.ts'])),
        getBranchHead: mock(() => Promise.resolve('mixed-head')),
        createBranch: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        checkoutFiles: mock((_: string, ref: string, files: string[]) => {
          checkoutFilesCalls.push({ ref, files });
          return Promise.resolve();
        }),
        add: mock((_: string, files: string[]) => {
          addCalls.push(files);
          return Promise.resolve();
        }),
        commit: mock(() => Promise.resolve('new-branch-head')),
        amendNoEdit: mock(() => Promise.resolve()),
        resetHard: mock(() => Promise.resolve()),
        lsTree: mock(() => Promise.resolve([])),
        rm: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildSplitByFileStack();
    const result = await BS.splitByFile('/tmp/repo', stack, 'feat/mixed', ['*.ts'], 'feat/ts-only');

    expect(result.movedFiles).toEqual(['api.ts', 'utils.ts']);
    expect(result.remainingFiles).toEqual(['config.json', 'schema.sql']);
    expect(result.newBranch).toBe('feat/ts-only');
  });

  test('remaining files stay on source branch', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('mb')),
        diffNameOnly: mock(() => Promise.resolve(['a.ts', 'b.json', 'c.ts'])),
        getBranchHead: mock(() => Promise.resolve('head')),
        createBranch: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        checkoutFiles: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        commit: mock(() => Promise.resolve('new-head')),
        amendNoEdit: mock(() => Promise.resolve()),
        lsTree: mock(() => Promise.resolve([])),
        rm: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildSplitByFileStack();
    const result = await BS.splitByFile('/tmp/repo', stack, 'feat/mixed', ['*.json'], 'feat/json-only');

    expect(result.movedFiles).toEqual(['b.json']);
    expect(result.remainingFiles).toEqual(['a.ts', 'c.ts']);
  });

  test('glob patterns match correctly (*.json, src/**)', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('mb')),
        diffNameOnly: mock(() =>
          Promise.resolve(['src/api/handler.ts', 'src/api/types.ts', 'config.json', 'README.md']),
        ),
        getBranchHead: mock(() => Promise.resolve('head')),
        createBranch: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        checkoutFiles: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        commit: mock(() => Promise.resolve('new-head')),
        amendNoEdit: mock(() => Promise.resolve()),
        lsTree: mock(() => Promise.resolve([])),
        rm: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildSplitByFileStack();
    const result = await BS.splitByFile('/tmp/repo', stack, 'feat/mixed', ['src/**'], 'feat/src');

    expect(result.movedFiles).toEqual(['src/api/handler.ts', 'src/api/types.ts']);
    expect(result.remainingFiles).toEqual(['config.json', 'README.md']);
  });

  test('throws when no files match the patterns', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('mb')),
        diffNameOnly: mock(() => Promise.resolve(['a.ts', 'b.ts'])),
        getBranchHead: mock(() => Promise.resolve('head')),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildSplitByFileStack();

    await expect(
      BS.splitByFile('/tmp/repo', stack, 'feat/mixed', ['*.json'], 'feat/json'),
    ).rejects.toThrow(/No files match/);
  });

  test('all files matching resets source to merge base', async () => {
    const resetCalls: string[] = [];

    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('mb-sha')),
        diffNameOnly: mock(() => Promise.resolve(['a.ts', 'b.ts'])),
        getBranchHead: mock(() => Promise.resolve('head')),
        createBranch: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        checkoutFiles: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        commit: mock(() => Promise.resolve('new-head')),
        resetHard: mock((_: string, ref: string) => {
          resetCalls.push(ref);
          return Promise.resolve();
        }),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildSplitByFileStack();
    const result = await BS.splitByFile('/tmp/repo', stack, 'feat/mixed', ['*.ts'], 'feat/ts');

    expect(result.movedFiles).toEqual(['a.ts', 'b.ts']);
    expect(result.remainingFiles).toEqual([]);
    expect(resetCalls).toContain('mb-sha');
  });

  test('new branch is added as sibling (child of same parent) in stack tree', async () => {
    mock.module('../src/core/git-shell.ts', () => ({
      GitShell: {
        ...GitShell,
        isDirty: mock(() => Promise.resolve(false)),
        hasUnstagedChanges: mock(() => Promise.resolve(false)),
        hasStagedChanges: mock(() => Promise.resolve(false)),
        getMergeBase: mock(() => Promise.resolve('mb')),
        diffNameOnly: mock(() => Promise.resolve(['a.ts', 'b.json'])),
        getBranchHead: mock(() => Promise.resolve('head')),
        createBranch: mock(() => Promise.resolve()),
        checkoutBranch: mock(() => Promise.resolve()),
        checkoutFiles: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
        commit: mock(() => Promise.resolve('new-head')),
        amendNoEdit: mock(() => Promise.resolve()),
        lsTree: mock(() => Promise.resolve([])),
        rm: mock(() => Promise.resolve()),
      },
    }));

    const { BranchSplitter: BS } = await import('../src/core/branch-splitter.ts');
    const stack = buildSplitByFileStack();
    const result = await BS.splitByFile('/tmp/repo', stack, 'feat/mixed', ['*.ts'], 'feat/ts');

    const newNode = StackManager.findNode(result.newStack, 'feat/ts');
    expect(newNode).toBeDefined();
    expect(newNode!.parent).toBe('main');
  });
});
