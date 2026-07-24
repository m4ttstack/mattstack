import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { GitShell as RealGitShell } from '../src/core/git-shell.ts';

afterAll(() => mock.restore());

mock.module('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(null, '1\n');
  },
}));

mock.module('../src/core/git-shell.ts', () => ({
  GitShell: {
    ...RealGitShell,
    listLocalBranches: mock(),
    isAncestor: mock(),
    getMergeBase: mock(),
    getBranchHead: mock(),
  },
}));

import { discoverLocalStacks } from '../src/core/discover.ts';
import { GitShell } from '../src/core/git-shell.ts';

const mockListBranches = GitShell.listLocalBranches as ReturnType<typeof mock>;
const mockIsAncestor = GitShell.isAncestor as ReturnType<typeof mock>;
const mockGetMergeBase = GitShell.getMergeBase as ReturnType<typeof mock>;
const mockGetBranchHead = GitShell.getBranchHead as ReturnType<typeof mock>;

describe('discoverLocalStacks', () => {
  beforeEach(() => {
    mockListBranches.mockReset();
    mockIsAncestor.mockReset();
    mockGetMergeBase.mockReset();
    mockGetBranchHead.mockReset();
  });

  test('returns empty when no branches exist', async () => {
    mockListBranches.mockResolvedValue([]);
    const result = await discoverLocalStacks('/repo');
    expect(result).toEqual([]);
  });

  test('returns empty when only root branches exist', async () => {
    mockListBranches.mockResolvedValue(['main']);
    const result = await discoverLocalStacks('/repo');
    expect(result).toEqual([]);
  });

  test('discovers a simple linear chain', async () => {
    mockListBranches.mockResolvedValue(['main', 'feat-a', 'feat-b']);

    mockIsAncestor.mockImplementation(async (_cwd: string, ancestor: string, desc: string) => {
      if (ancestor === 'main' && desc === 'feat-a') return true;
      if (ancestor === 'main' && desc === 'feat-b') return true;
      if (ancestor === 'feat-a' && desc === 'feat-b') return true;
      return false;
    });

    mockGetMergeBase.mockImplementation(async (_cwd: string, a: string, b: string) => {
      if (a === 'feat-a' && b === 'feat-b') return 'commit-a';
      return 'commit-main';
    });

    mockGetBranchHead.mockImplementation(async (_cwd: string, branch: string) => {
      if (branch === 'main') return 'commit-main-tip';
      if (branch === 'feat-a') return 'commit-a';
      if (branch === 'feat-b') return 'commit-b';
      return 'unknown';
    });

    const result = await discoverLocalStacks('/repo');

    expect(result).toHaveLength(1);
    expect(result[0]!.root).toBe('main');
    expect(result[0]!.branches).toEqual([
      { branch: 'feat-a', parent: 'main' },
      { branch: 'feat-b', parent: 'feat-a' },
    ]);
  });

  test('handles branches that are not descendants of any root', async () => {
    mockListBranches.mockResolvedValue(['main', 'orphan']);
    mockIsAncestor.mockResolvedValue(false);

    const result = await discoverLocalStacks('/repo');
    expect(result).toEqual([]);
  });

  test('uses defaultRoot when no common root found', async () => {
    mockListBranches.mockResolvedValue(['release', 'feat-x']);

    mockIsAncestor.mockImplementation(async (_cwd: string, ancestor: string, desc: string) => {
      if (ancestor === 'release' && desc === 'feat-x') return true;
      return false;
    });

    mockGetMergeBase.mockResolvedValue('commit-rel');
    mockGetBranchHead.mockImplementation(async (_cwd: string, branch: string) => {
      if (branch === 'release') return 'commit-rel-tip';
      return 'commit-x';
    });

    const result = await discoverLocalStacks('/repo', 'release');

    expect(result).toHaveLength(1);
    expect(result[0]!.root).toBe('release');
    expect(result[0]!.branches).toEqual([{ branch: 'feat-x', parent: 'release' }]);
  });
});
