import { describe, test, expect, afterEach } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { OperationLog, type OperationEntry } from '../../src/core/operation-log.ts';
import { undo } from '../../src/core/undo.ts';
import type { Stack } from '../../src/core/types.ts';
import {
  addNamedWorktree,
  buildLinearStack,
  cleanupRepo,
  commit,
  createSandboxRepo,
  gitIn,
  type SandboxRepo,
} from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

interface Cascaded {
  repo: SandboxRepo;
  stack: Stack;
  entry: OperationEntry;
  /** Pre-op heads, root included, as withOperationLog snapshots them. */
  before: Map<string, string>;
  /** Post-op heads. */
  after: Map<string, string>;
}

/**
 * A three-branch stack cascaded onto an advanced main, logged the way
 * withOperationLog logs it: root and nodes snapshotted before, every head
 * recorded after. Leaves the launch tree on main.
 */
async function cascadedStack(): Promise<Cascaded> {
  const repo = await createSandboxRepo();
  dirs.push(repo.dir);
  const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 3);

  const branchSnapshots = Object.fromEntries(shas);
  const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots, repo.dir);

  repo.git('checkout', 'main');
  await commit(repo.dir, repo.git, 'main-advance.txt', 'advance\n', 'advance main');
  let base = repo.git('rev-parse', 'HEAD');
  let oldBase = shas.get('main')!;
  for (let i = 1; i <= 3; i++) {
    const branch = `feat/branch-${i}`;
    await RebaseEngine.rebaseSingle(repo.dir, base, oldBase, branch);
    oldBase = shas.get(branch)!;
    base = await GitShell.getBranchHead(repo.dir, branch);
  }
  repo.git('checkout', 'main');

  const after = new Map<string, string>();
  for (const branch of ['main', ...stack.nodes.map((n) => n.branch)]) {
    after.set(branch, await GitShell.getBranchHead(repo.dir, branch));
  }
  entry.resultHeads = Object.fromEntries(after);
  return { repo, stack, entry, before: shas, after };
}

const head = (repo: SandboxRepo, branch: string) => repo.git('rev-parse', `refs/heads/${branch}`);

describe('undo moves refs by compare-and-swap', () => {
  test('a dirty launch tree is refused before any ref moves', async () => {
    const { repo, entry, after } = await cascadedStack();
    await writeFile(join(repo.dir, 'README.md'), 'uncommitted edit\n', 'utf-8');

    const result = await undo(repo.dir, entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('uncommitted changes');
    expect(result.restoredBranches).toEqual([]);
    for (const [branch, sha] of after) expect(head(repo, branch)).toBe(sha);
    expect(await readFile(join(repo.dir, 'README.md'), 'utf-8')).toBe('uncommitted edit\n');
  });

  test('the stack root is never checked out or moved', async () => {
    const { repo, entry, before, after } = await cascadedStack();
    repo.git('checkout', 'feat/branch-3');

    const result = await undo(repo.dir, entry);

    expect(result.success).toBe(true);
    expect(result.restoredBranches).not.toContain('main');
    expect(head(repo, 'main')).toBe(after.get('main')!);
    expect(repo.git('symbolic-ref', '--short', 'HEAD')).toBe('feat/branch-3');
    for (let i = 1; i <= 3; i++) {
      expect(head(repo, `feat/branch-${i}`)).toBe(before.get(`feat/branch-${i}`)!);
    }
  });

  test('undo from a secondary worktree restores every branch while trunk stays checked out elsewhere', async () => {
    const { repo, entry, before, after } = await cascadedStack();
    const secondary = await addNamedWorktree(repo, 'second');
    dirs.push(secondary);
    const detachedAt = gitIn(secondary)('rev-parse', 'HEAD');

    const result = await undo(secondary, entry);

    expect(result.success).toBe(true);
    expect([...result.restoredBranches].sort()).toEqual(['feat/branch-1', 'feat/branch-2', 'feat/branch-3']);
    for (let i = 1; i <= 3; i++) {
      expect(head(repo, `feat/branch-${i}`)).toBe(before.get(`feat/branch-${i}`)!);
    }
    expect(head(repo, 'main')).toBe(after.get('main')!);
    expect(repo.git('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(gitIn(secondary)('rev-parse', 'HEAD')).toBe(detachedAt);
  });

  test('branches that moved since the operation are all named and nothing moves', async () => {
    const { repo, entry, after } = await cascadedStack();
    const newer = new Map<string, string>();
    for (const branch of ['feat/branch-2', 'feat/branch-3']) {
      repo.git('checkout', branch);
      newer.set(branch, await commit(repo.dir, repo.git, `after-${branch.slice(-1)}.txt`, 'newer\n', 'work after the cascade'));
    }
    repo.git('checkout', 'main');

    const result = await undo(repo.dir, entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('feat/branch-2');
    expect(result.error).toContain('feat/branch-3');
    expect(result.restoredBranches).toEqual([]);
    expect(head(repo, 'feat/branch-1')).toBe(after.get('feat/branch-1')!);
    expect(head(repo, 'feat/branch-2')).toBe(newer.get('feat/branch-2')!);
    expect(head(repo, 'feat/branch-3')).toBe(newer.get('feat/branch-3')!);
  });

  test('a move that fails mid-way names the branch and reports the branches already restored', async () => {
    const { repo, entry, before, after } = await cascadedStack();
    const slot = await addNamedWorktree(repo, 'held', 'feat/branch-2');
    dirs.push(slot);
    await writeFile(join(slot, 'README.md'), 'dirty in the slot\n', 'utf-8');

    const result = await undo(repo.dir, entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('feat/branch-2');
    expect(result.restoredBranches).toEqual(['feat/branch-1']);
    expect(head(repo, 'feat/branch-1')).toBe(before.get('feat/branch-1')!);
    expect(head(repo, 'feat/branch-2')).toBe(after.get('feat/branch-2')!);
    expect(head(repo, 'feat/branch-3')).toBe(after.get('feat/branch-3')!);
  });
});
