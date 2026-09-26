import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit, type SandboxRepo } from './helpers.ts';

mock.restore();

let repo: SandboxRepo;

beforeAll(async () => {
  repo = await createSandboxRepo();

  // Create a feature branch with a commit
  repo.git('checkout', '-b', 'feat/test-branch');
  await writeFile(join(repo.dir, 'feature.ts'), 'export const x = 1;\n', 'utf-8');
  repo.git('add', '.');
  repo.git('commit', '-m', 'add feature');

  // Go back to main
  repo.git('checkout', 'main');
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
});

describe('GitShell integration', () => {
  test('getCurrentBranch returns the current branch', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const branch = await GitShell.getCurrentBranch(repo.dir);
    expect(branch).toBe('main');
  });

  test('getBranchHead returns a valid SHA', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const sha = await GitShell.getBranchHead(repo.dir, 'main');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test('branchExists returns true for existing branch', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.branchExists(repo.dir, 'main')).toBe(true);
    expect(await GitShell.branchExists(repo.dir, 'feat/test-branch')).toBe(true);
  });

  test('branchExists returns false for non-existent branch', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.branchExists(repo.dir, 'does-not-exist')).toBe(false);
  });

  test('isDirty detects uncommitted changes', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.isDirty(repo.dir)).toBe(false);

    // Make the tree dirty (tracked file modification, not untracked)
    await writeFile(join(repo.dir, 'README.md'), '# Modified\n', 'utf-8');
    expect(await GitShell.isDirty(repo.dir)).toBe(true);

    // Restore the file
    repo.git('checkout', '--', 'README.md');
  });

  test('log returns commit lines', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const lines = await GitShell.log(repo.dir, 'main', 10);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('initial commit');
  });

  test('getRepoRoot returns the repo directory', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const root = await GitShell.getRepoRoot(repo.dir);
    const { realpathSync } = await import('node:fs');
    expect(realpathSync(root)).toBe(realpathSync(repo.dir));
  });

  test('createBranch creates and checks out a new branch', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    await GitShell.createBranch(repo.dir, 'feat/new-branch', 'main');
    const branch = await GitShell.getCurrentBranch(repo.dir);
    expect(branch).toBe('feat/new-branch');
    expect(await GitShell.branchExists(repo.dir, 'feat/new-branch')).toBe(true);

    await GitShell.checkoutBranch(repo.dir, 'main');
  });

  test('getMergeBase returns a valid commit', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const mergeBase = await GitShell.getMergeBase(repo.dir, 'main', 'feat/test-branch');
    expect(mergeBase).toMatch(/^[0-9a-f]{40}$/);

    const mainHead = await GitShell.getBranchHead(repo.dir, 'main');
    expect(mergeBase).toBe(mainHead);
  });

  test('listLocalBranches returns all local branches', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const branches = await GitShell.listLocalBranches(repo.dir);
    expect(branches).toContain('main');
    expect(branches).toContain('feat/test-branch');
    expect(branches.length).toBeGreaterThanOrEqual(2);
  });

  test('listWorktrees returns the main worktree', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const worktrees = await GitShell.listWorktrees(repo.dir);
    expect(worktrees.length).toBeGreaterThanOrEqual(1);
    expect(worktrees[0]!.path).toBe(repo.dir);
    expect(worktrees[0]!.branch).toBe('main');
    expect(worktrees[0]!.bare).toBe(false);
  });

  test('getCommonDir returns the repo root', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const commonDir = await GitShell.getCommonDir(repo.dir);
    expect(commonDir).toBe(repo.dir);
  });

  test('isAncestor returns true for parent-child relationship', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.isAncestor(repo.dir, 'main', 'feat/test-branch')).toBe(true);
  });

  test('isAncestor returns false for unrelated branches', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.isAncestor(repo.dir, 'feat/test-branch', 'main')).toBe(false);
  });
});

// ── Paths git quotes ─────────────────────────────────────────────────────────
//
// With `core.quotePath` at its default, git C-quotes any path it considers
// unusual, so `café.txt` comes back as `"caf\303\251.txt"`. That string names no
// file on disk and matches no glob a user would type, so a consumer comparing it
// against another path, or against a `--files` pattern, silently selects the
// wrong set. `-z` output is the fix: NUL-terminated paths are never quoted.

describe('GitShell path listings with a non-ASCII filename', () => {
  /** A repo whose `uni` branch adds `café.ts` and modifies a plain file. */
  async function uniRepo(): Promise<SandboxRepo> {
    const r = await createSandboxRepo();
    r.git('checkout', '-b', 'uni');
    await writeFile(join(r.dir, 'café.ts'), 'export const cafe = 1;\n', 'utf-8');
    await writeFile(join(r.dir, 'plain.ts'), 'export const plain = 1;\n', 'utf-8');
    r.git('add', '.');
    r.git('commit', '-m', 'uni: add café.ts and plain.ts');
    return r;
  }

  test('diffNameOnly returns the real path, not the C-quoted one', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const r = await uniRepo();
    try {
      const files = await GitShell.diffNameOnly(r.dir, 'main', 'uni');

      expect(files).toEqual(['café.ts', 'plain.ts']);
      expect(files.some((f) => f.includes('\\303'))).toBe(false);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('lsTree returns the real path, not the C-quoted one', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const r = await uniRepo();
    try {
      const files = await GitShell.lsTree(r.dir, 'uni');

      expect(files).toContain('café.ts');
      expect(files.some((f) => f.includes('\\303'))).toBe(false);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('lsTreePath returns the real path, not the C-quoted one', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'uni');
      await Bun.write(join(r.dir, 'dir', 'café.ts'), 'export const cafe = 1;\n');
      r.git('add', '.');
      r.git('commit', '-m', 'uni: add dir/café.ts');

      const files = await GitShell.lsTreePath(r.dir, 'uni', 'dir');

      expect(files).toEqual(['dir/café.ts']);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('diffNameStatus returns the real path for a plain change and a rename', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const r = await uniRepo();
    try {
      // A rename to a non-ASCII destination: -z puts status, from and to in
      // three NUL-separated fields rather than one tab-joined line.
      r.git('checkout', '-b', 'renamed');
      r.git('mv', 'plain.ts', 'plané.ts');
      await writeFile(join(r.dir, 'café.ts'), 'export const cafe = 2;\n', 'utf-8');
      r.git('add', '.');
      r.git('commit', '-m', 'renamed: mv plain.ts and touch café.ts');

      const entries = await GitShell.diffNameStatus(r.dir, 'uni', 'renamed');
      const byPath = new Map(entries.map((e) => [e.path, e]));

      expect(byPath.get('café.ts')?.status).toBe('M');
      const rename = entries.find((e) => e.status === 'R');
      expect(rename?.path).toBe('plain.ts');
      expect(rename?.to).toBe('plané.ts');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});
