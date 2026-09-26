import { describe, expect, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';

describe('reparentBranch integration', () => {
  test('linear reparent — content integrity', async () => {
    const { reparentBranch } = await import('../../src/core/reparent.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main → A (adds a.txt) → B (adds b.txt) → C (adds c.txt)
      r.git('checkout', '-b', 'feat/A');
      const aHead = await commit(r.dir, r.git, 'a.txt', 'A content\n', 'add a.txt');

      r.git('checkout', '-b', 'feat/B');
      const bHead = await commit(r.dir, r.git, 'b.txt', 'B content\n', 'add b.txt');

      r.git('checkout', '-b', 'feat/C');
      const cHead = await commit(r.dir, r.git, 'c.txt', 'C content\n', 'add c.txt');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/A', 'main');
      stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: aHead });
      stack = StackManager.addNode(stack, 'feat/B', 'feat/A');
      stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: bHead });
      stack = StackManager.addNode(stack, 'feat/C', 'feat/B');
      stack = StackManager.updateNode(stack, 'feat/C', { lastKnownHead: cHead });

      // Reparent C from B to A
      const result = await reparentBranch(r.dir, stack, 'feat/C', 'feat/A');

      // C should now be a child of A in the tree
      const cNode = StackManager.findNode(result.newStack, 'feat/C');
      expect(cNode!.parent).toBe('feat/A');

      // C's merge-base with A should be A's HEAD
      const mb = await GitShell.getMergeBase(r.dir, 'feat/C', 'feat/A');
      const currentAHead = await GitShell.getBranchHead(r.dir, 'feat/A');
      expect(mb).toBe(currentAHead);

      // C should have its own file + A's files (but NOT B's b.txt since it's no longer stacked on B)
      r.git('checkout', 'feat/C');
      expect(await readFile(join(r.dir, 'c.txt'), 'utf-8')).toBe('C content\n');
      expect(await readFile(join(r.dir, 'a.txt'), 'utf-8')).toBe('A content\n');

      const files = r.git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
      expect(files).not.toContain('b.txt');

      // B is unchanged
      r.git('checkout', 'feat/B');
      expect(await readFile(join(r.dir, 'b.txt'), 'utf-8')).toBe('B content\n');

      expect(result.branch).toBe('feat/C');
      expect(result.oldParent).toBe('feat/B');
      expect(result.newParent).toBe('feat/A');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('fan-out reparent — sibling becomes child', async () => {
    const { reparentBranch } = await import('../../src/core/reparent.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main → A → [B, C] (fan-out)
      r.git('checkout', '-b', 'feat/A');
      const aHead = await commit(r.dir, r.git, 'a.txt', 'A content\n', 'add a.txt');

      r.git('checkout', '-b', 'feat/B');
      const bHead = await commit(r.dir, r.git, 'b.txt', 'B content\n', 'add b.txt');

      r.git('checkout', 'feat/A');
      r.git('checkout', '-b', 'feat/C');
      const cHead = await commit(r.dir, r.git, 'c.txt', 'C content\n', 'add c.txt');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/A', 'main');
      stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: aHead });
      stack = StackManager.addNode(stack, 'feat/B', 'feat/A');
      stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: bHead });
      stack = StackManager.addNode(stack, 'feat/C', 'feat/A');
      stack = StackManager.updateNode(stack, 'feat/C', { lastKnownHead: cHead });

      // Reparent B under C (B becomes C's child)
      const result = await reparentBranch(r.dir, stack, 'feat/B', 'feat/C');

      const bNode = StackManager.findNode(result.newStack, 'feat/B');
      expect(bNode!.parent).toBe('feat/C');

      // B should now have C's files in its history
      r.git('checkout', 'feat/B');
      expect(await readFile(join(r.dir, 'c.txt'), 'utf-8')).toBe('C content\n');
      expect(await readFile(join(r.dir, 'b.txt'), 'utf-8')).toBe('B content\n');

      // B's merge-base with C should be C's HEAD
      const mb = await GitShell.getMergeBase(r.dir, 'feat/B', 'feat/C');
      const cCurrentHead = await GitShell.getBranchHead(r.dir, 'feat/C');
      expect(mb).toBe(cCurrentHead);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('reparent with descendants — children cascade', async () => {
    const { reparentBranch } = await import('../../src/core/reparent.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main → A → B → [C, D]
      r.git('checkout', '-b', 'feat/A');
      const aHead = await commit(r.dir, r.git, 'a.txt', 'A content\n', 'add a.txt');

      r.git('checkout', '-b', 'feat/B');
      const bHead = await commit(r.dir, r.git, 'b.txt', 'B content\n', 'add b.txt');

      r.git('checkout', '-b', 'feat/C');
      const cHead = await commit(r.dir, r.git, 'c.txt', 'C content\n', 'add c.txt');

      r.git('checkout', 'feat/B');
      r.git('checkout', '-b', 'feat/D');
      const dHead = await commit(r.dir, r.git, 'd.txt', 'D content\n', 'add d.txt');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/A', 'main');
      stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: aHead });
      stack = StackManager.addNode(stack, 'feat/B', 'feat/A');
      stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: bHead });
      stack = StackManager.addNode(stack, 'feat/C', 'feat/B');
      stack = StackManager.updateNode(stack, 'feat/C', { lastKnownHead: cHead });
      stack = StackManager.addNode(stack, 'feat/D', 'feat/B');
      stack = StackManager.updateNode(stack, 'feat/D', { lastKnownHead: dHead });

      // Reparent B (with children C, D) under main
      const result = await reparentBranch(r.dir, stack, 'feat/B', 'main');

      const bNode = StackManager.findNode(result.newStack, 'feat/B');
      expect(bNode!.parent).toBe('main');

      // C and D should have been cascade-rebased
      expect(result.cascadeResult).not.toBeNull();

      // B's merge-base with main should be main's HEAD
      const mb = await GitShell.getMergeBase(r.dir, 'feat/B', 'main');
      const mainHead = await GitShell.getBranchHead(r.dir, 'main');
      expect(mb).toBe(mainHead);

      // All file contents intact
      r.git('checkout', 'feat/B');
      expect(await readFile(join(r.dir, 'b.txt'), 'utf-8')).toBe('B content\n');
      // B should NOT have a.txt since it's now directly on main
      const bFiles = r.git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
      expect(bFiles).not.toContain('a.txt');

      r.git('checkout', 'feat/C');
      expect(await readFile(join(r.dir, 'c.txt'), 'utf-8')).toBe('C content\n');
      expect(await readFile(join(r.dir, 'b.txt'), 'utf-8')).toBe('B content\n');

      r.git('checkout', 'feat/D');
      expect(await readFile(join(r.dir, 'd.txt'), 'utf-8')).toBe('D content\n');
      expect(await readFile(join(r.dir, 'b.txt'), 'utf-8')).toBe('B content\n');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('reparent conflict — reports error cleanly', async () => {
    const { reparentBranch } = await import('../../src/core/reparent.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      // Build two branches that edit the same file differently
      r.git('checkout', '-b', 'feat/A');
      await commit(r.dir, r.git, 'shared.txt', 'version A\n', 'add shared.txt on A');

      r.git('checkout', 'main');
      r.git('checkout', '-b', 'feat/B');
      await commit(r.dir, r.git, 'shared.txt', 'version B\n', 'add shared.txt on B');

      r.git('checkout', 'main');

      const aHead = r.git('rev-parse', 'feat/A');
      const bHead = r.git('rev-parse', 'feat/B');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/A', 'main');
      stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: aHead });
      stack = StackManager.addNode(stack, 'feat/B', 'main');
      stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: bHead });

      // Reparent B under A — this should conflict on shared.txt
      await expect(reparentBranch(r.dir, stack, 'feat/B', 'feat/A')).rejects.toThrow();

      // Abort any lingering rebase
      try { await GitShell.rebaseAbort(r.dir); } catch { /* no rebase in progress is fine */ }

      // Repo should not be in a broken state
      r.git('checkout', 'main');
      const dirty = await GitShell.isDirty(r.dir);
      expect(dirty).toBe(false);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('no-op reparent — SHAs unchanged', async () => {
    const { reparentBranch } = await import('../../src/core/reparent.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/A');
      const aHead = await commit(r.dir, r.git, 'a.txt', 'A content\n', 'add a.txt');

      r.git('checkout', '-b', 'feat/B');
      const bHead = await commit(r.dir, r.git, 'b.txt', 'B content\n', 'add b.txt');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/A', 'main');
      stack = StackManager.updateNode(stack, 'feat/A', { lastKnownHead: aHead });
      stack = StackManager.addNode(stack, 'feat/B', 'feat/A');
      stack = StackManager.updateNode(stack, 'feat/B', { lastKnownHead: bHead });

      // Reparent B to its current parent (feat/A) — should be a no-op
      const result = await reparentBranch(r.dir, stack, 'feat/B', 'feat/A');

      expect(result.newStack).toBe(stack);
      expect(result.cascadeResult).toBeNull();

      // SHA unchanged
      const currentBHead = await GitShell.getBranchHead(r.dir, 'feat/B');
      expect(currentBHead).toBe(bHead);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});
