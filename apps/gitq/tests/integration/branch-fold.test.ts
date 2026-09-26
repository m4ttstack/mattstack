import { describe, expect, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';

describe('foldBranch integration', () => {
  test('fold into parent — content integrity', async () => {
    const { foldBranch } = await import('../../src/core/branch-fold.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      // Build: main → feat/base (adds base.txt) → feat/child (adds child.txt, edits base.txt)
      r.git('checkout', '-b', 'feat/base');
      const baseHead = await commit(r.dir, r.git, 'base.txt', 'base content\n', 'add base.txt');

      r.git('checkout', '-b', 'feat/child');
      await commit(r.dir, r.git, 'child.txt', 'child content\n', 'add child.txt');
      const childHead = await commit(r.dir, r.git, 'base.txt', 'base content updated by child\n', 'edit base.txt');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/base', 'main');
      stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
      stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

      const result = await foldBranch(r.dir, stack, 'feat/child');

      // feat/child should be deleted
      const branches = r.git('branch', '--list').split('\n').map((b: string) => b.trim().replace('* ', ''));
      expect(branches).not.toContain('feat/child');

      // feat/base should have both files with child's edits
      r.git('checkout', 'feat/base');
      const baseContent = await readFile(join(r.dir, 'base.txt'), 'utf-8');
      expect(baseContent).toBe('base content updated by child\n');
      const childContent = await readFile(join(r.dir, 'child.txt'), 'utf-8');
      expect(childContent).toBe('child content\n');

      // git log should show the cherry-picked commits
      const log = await GitShell.logDetailed(r.dir, 'feat/base', 10);
      const subjects = log.map((c) => c.subject);
      expect(subjects).toContain('add child.txt');
      expect(subjects).toContain('edit base.txt');

      // Stack tree should no longer have feat/child
      expect(StackManager.findNode(result.newStack, 'feat/child')).toBeUndefined();
      expect(result.foldedBranch).toBe('feat/child');
      expect(result.intoParent).toBe('feat/base');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('fold with grandchildren — re-parenting + content intact', async () => {
    const { foldBranch } = await import('../../src/core/branch-fold.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');

    const r = await createSandboxRepo();
    try {
      // Stack: main → A → B → [C, D]
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

      // Fold B into A
      const result = await foldBranch(r.dir, stack, 'feat/B');

      // C and D should now be children of A
      const cNode = StackManager.findNode(result.newStack, 'feat/C');
      const dNode = StackManager.findNode(result.newStack, 'feat/D');
      expect(cNode!.parent).toBe('feat/A');
      expect(dNode!.parent).toBe('feat/A');

      // Verify content on C and D is still intact
      r.git('checkout', 'feat/C');
      expect(await readFile(join(r.dir, 'c.txt'), 'utf-8')).toBe('C content\n');

      r.git('checkout', 'feat/D');
      expect(await readFile(join(r.dir, 'd.txt'), 'utf-8')).toBe('D content\n');

      // A should have both a.txt and b.txt
      r.git('checkout', 'feat/A');
      expect(await readFile(join(r.dir, 'a.txt'), 'utf-8')).toBe('A content\n');
      expect(await readFile(join(r.dir, 'b.txt'), 'utf-8')).toBe('B content\n');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('fold rejects dirty working tree', async () => {
    const { foldBranch } = await import('../../src/core/branch-fold.ts');
    const { writeFile } = await import('node:fs/promises');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/base');
      const baseHead = await commit(r.dir, r.git, 'base.txt', 'content\n', 'base');
      r.git('checkout', '-b', 'feat/child');
      const childHead = await commit(r.dir, r.git, 'child.txt', 'content\n', 'child');
      r.git('checkout', 'main');

      // Make dirty
      await writeFile(join(r.dir, 'dirty.txt'), 'dirty\n');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/base', 'main');
      stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
      stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

      await expect(foldBranch(r.dir, stack, 'feat/child')).rejects.toThrow(/uncommitted changes/);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});
