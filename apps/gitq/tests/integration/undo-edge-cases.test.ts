import { describe, test, expect, afterEach } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { OperationLog } from '../../src/core/operation-log.ts';
import { canUndo, undo } from '../../src/core/undo.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { writeFile } from 'node:fs/promises';
import {
  createSandboxRepo,
  cleanupRepo,
  commit,
  buildLinearStack,
  buildTreeStack,
} from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Undo after branch deletion ───────────────────────────────────────────────

describe('Undo when a branch was deleted externally', () => {
  test('undo skips deleted branches and restores surviving ones', async () => {
    const repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 3);

    const branchSnapshots: Record<string, string> = {};
    for (const node of stack.nodes) {
      branchSnapshots[node.branch] = shas.get(node.branch)!;
    }
    const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots);

    // Advance main and rebase all branches
    repo.git('checkout', 'main');
    await commit(repo.dir, repo.git, 'advance.txt', 'advance\n', 'advance');
    const mainHead = repo.git('rev-parse', 'HEAD');

    await RebaseEngine.rebaseSingle(repo.dir, mainHead, shas.get('main')!, 'feat/branch-1');
    const newB1 = await GitShell.getBranchHead(repo.dir, 'feat/branch-1');
    await RebaseEngine.rebaseSingle(repo.dir, newB1, shas.get('feat/branch-1')!, 'feat/branch-2');
    const newB2 = await GitShell.getBranchHead(repo.dir, 'feat/branch-2');
    await RebaseEngine.rebaseSingle(repo.dir, newB2, shas.get('feat/branch-2')!, 'feat/branch-3');

    // Delete branch-2 externally
    repo.git('checkout', 'main');
    repo.git('branch', '-D', 'feat/branch-2');

    const result = await undo(repo.dir, entry);

    // Undo succeeds overall — deleted branch is skipped, not fatal
    expect(result.success).toBe(true);
    expect(result.error).toContain('feat/branch-2');

    // Surviving branches are restored
    expect(result.restoredBranches).toContain('feat/branch-1');
    expect(result.restoredBranches).toContain('feat/branch-3');
    expect(result.restoredBranches).not.toContain('feat/branch-2');

    // Restored branches have their original SHAs
    const b1Head = await GitShell.getBranchHead(repo.dir, 'feat/branch-1');
    expect(b1Head).toBe(shas.get('feat/branch-1')!);
    const b3Head = await GitShell.getBranchHead(repo.dir, 'feat/branch-3');
    expect(b3Head).toBe(shas.get('feat/branch-3')!);
  });
});

// ── Undo deep stack ──────────────────────────────────────────────────────────

describe('Undo deep stack rebase', () => {
  test('undo 5-level cascade restores all SHAs and content', async () => {
    const repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 5);

    const branchSnapshots: Record<string, string> = {};
    for (const node of stack.nodes) {
      branchSnapshots[node.branch] = shas.get(node.branch)!;
    }
    const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots);

    // Advance main and cascade
    repo.git('checkout', 'main');
    await commit(repo.dir, repo.git, 'advance.txt', 'advance\n', 'advance');
    const mainHead = repo.git('rev-parse', 'HEAD');

    let prevBase = shas.get('main')!;
    let prevHead = mainHead;
    for (let i = 1; i <= 5; i++) {
      await RebaseEngine.rebaseSingle(repo.dir, prevHead, prevBase, `feat/branch-${i}`);
      prevBase = shas.get(`feat/branch-${i}`)!;
      prevHead = await GitShell.getBranchHead(repo.dir, `feat/branch-${i}`);
    }

    // Verify branches moved
    for (let i = 1; i <= 5; i++) {
      const head = await GitShell.getBranchHead(repo.dir, `feat/branch-${i}`);
      expect(head).not.toBe(shas.get(`feat/branch-${i}`));
    }

    // Undo
    const result = await undo(repo.dir, entry);
    expect(result.success).toBe(true);
    expect(result.restoredBranches).toHaveLength(5);

    // Verify all SHAs restored
    for (let i = 1; i <= 5; i++) {
      const head = await GitShell.getBranchHead(repo.dir, `feat/branch-${i}`);
      expect(head).toBe(shas.get(`feat/branch-${i}`)!);
    }

    // Verify content on deepest branch
    repo.git('checkout', 'feat/branch-5');
    expect(await readFile(join(repo.dir, 'file-5-a.txt'), 'utf-8')).toBe('branch 5 commit A\n');
  });
});

// ── Undo absorb ──────────────────────────────────────────────────────────────

describe('Undo absorb operation', () => {
  test('undo after absorb restores branches to pre-absorb state', async () => {
    const repo = await createSandboxRepo();
    dirs.push(repo.dir);
    const { dir, git } = repo;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'add api');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'config.json', '{"key":"value"}\n', 'add config');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    // Snapshot before absorb
    const branchSnapshots: Record<string, string> = {
      'branch-1': sha1,
      'branch-2': sha2,
    };
    const entry = OperationLog.create('absorb', stack, branchSnapshots);

    // Perform absorb
    git('checkout', 'branch-2');
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    const result = await AbsorbEngine.absorb(dir, stack);
    expect(result.absorbed).toBe(true);

    // Verify branches moved
    const b1After = await GitShell.getBranchHead(dir, 'branch-1');
    expect(b1After).not.toBe(sha1);

    // Undo
    const undoResult = await undo(dir, entry);
    expect(undoResult.success).toBe(true);

    // Branches restored
    const b1Restored = await GitShell.getBranchHead(dir, 'branch-1');
    expect(b1Restored).toBe(sha1);

    // Original content restored
    git('checkout', 'branch-1');
    const apiContent = await readFile(join(dir, 'api.ts'), 'utf-8');
    expect(apiContent).toBe('export function api() {}\n');
  });
});

// ── Undo fan-out cascade ─────────────────────────────────────────────────────

describe('Undo fan-out cascade', () => {
  test('undo cascade on tree stack restores all branches', async () => {
    const repo = await createSandboxRepo();
    dirs.push(repo.dir);
    const { dir, git } = repo;

    const { stack, shas } = await buildTreeStack(dir, git, [
      {
        name: 'feat/a',
        commits: 2,
        children: [
          { name: 'feat/b', commits: 2 },
          { name: 'feat/c', commits: 2 },
        ],
      },
    ]);

    const branchSnapshots: Record<string, string> = {};
    for (const [branch, sha] of shas) {
      if (branch !== 'main') branchSnapshots[branch] = sha;
    }
    const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots);

    // Advance main and cascade
    git('checkout', 'main');
    await commit(dir, git, 'advance.txt', 'advance\n', 'advance');

    const oldAHead = shas.get('feat/a')!;
    const forkPoint = git('merge-base', 'main', 'feat/a');
    await GitShell.rebaseOnto(dir, 'main', forkPoint, 'feat/a');
    const newAHead = git('rev-parse', 'feat/a');

    // Cascade B and C
    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      let updatedStack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: oldAHead });
      const cascadeResult = await RebaseEngine.cascadeRebase(dir, updatedStack, 'feat/a', 'feat/a');
      expect(cascadeResult.results.every((r) => r.success)).toBe(true);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }

    // Undo
    const undoResult = await undo(dir, entry);
    expect(undoResult.success).toBe(true);

    // All branches restored
    for (const [branch, sha] of shas) {
      if (branch === 'main') continue;
      const head = await GitShell.getBranchHead(dir, branch);
      expect(head).toBe(sha);
    }
  });
});

// ── canUndo correctness ──────────────────────────────────────────────────────

describe('canUndo edge cases', () => {
  test('all reversible operation types', () => {
    const repo = { root: 'main', name: 'test', nodes: [] } as any;
    const snap = { main: 'sha' };

    for (const type of ['cascade-rebase', 'reparent', 'absorb', 'sync'] as const) {
      const entry = OperationLog.create(type, repo, snap);
      expect(canUndo(entry)).toBe(true);
    }
  });

  test('all non-reversible operation types', () => {
    const repo = { root: 'main', name: 'test', nodes: [] } as any;
    const snap = { main: 'sha' };

    for (const type of ['fold', 'split'] as const) {
      const entry = OperationLog.create(type, repo, snap);
      expect(canUndo(entry)).toBe(false);
    }
  });

  test('undo with empty branch snapshots returns clean error', async () => {
    const repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack } = await buildLinearStack(repo.dir, repo.git, 1);
    const entry = OperationLog.create('cascade-rebase', stack, {});

    const result = await undo(repo.dir, entry);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No branch snapshots');
  });
});
