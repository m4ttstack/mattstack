/**
 * Integration tests for Stack Diagnostics.
 *
 * Creates real git repos with actual branches, commits, merges, and remote
 * operations, then runs collectSnapshot + diagnoseStack to verify the full
 * pipeline classifies situations correctly.
 */

import { describe, test, expect, mock } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StackManager } from '../../src/core/stack-manager.ts';
import { collectSnapshot, diagnoseStack } from '../../src/core/stack-diagnostics.ts';
import type { Stack } from '../../src/core/types.ts';
import {
  createSandboxRepoWithRemote,
  cleanupRepo,
  commit,
  buildLinearStack,
  type SandboxRepoWithRemote,
} from './helpers.ts';

mock.restore();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Push all stack branches to origin. */
function pushAll(r: SandboxRepoWithRemote, stack: Stack): void {
  for (const node of stack.nodes) {
    r.git('push', 'origin', node.branch);
  }
}

/** Mark all stack nodes as synced (simulates what forge-sync does after publish). */
function markAllSynced(stack: Stack): Stack {
  let s = stack;
  for (const node of stack.nodes) {
    if (node.status === 'local-only') {
      s = StackManager.updateNode(s, node.branch, { status: 'synced' });
    }
  }
  return s;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('collectSnapshot + diagnoseStack integration', () => {
  test('all synced — no issues detected', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 2);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      expect(snapshot.isDirty).toBe(false);
      expect(snapshot.rebaseInProgress).toBe(false);

      for (const node of stack.nodes) {
        const dir = result.nodes.get(node.branch)!;
        expect(dir.situation).toBe('synced');
        expect(dir.primaryAction).toBeNull();
      }
      expect(result.banner).toBeNull();
      expect(result.globalBlocks).toHaveLength(0);
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('behind parent — trunk advanced, child is behind', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 1);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Advance main with a new commit
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'new-on-main.txt', 'new\n', 'advance main');
      r.git('push', 'origin', 'main');

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      const child = result.nodes.get('feat/branch-1')!;
      expect(child.situation).toBe('behind-parent');
      expect(child.primaryAction!.id).toBe('sync-stack');
      expect(child.badge!.label).toBe('Behind');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('parent merged — squash merge simulated', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 2);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Simulate squash-merge of branch-1 into main
      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/branch-1');
      r.git('commit', '-m', 'squash-merge feat/branch-1');
      const tombstone = r.git('rev-parse', 'HEAD');

      // Mark branch-1 as merged in the stack config
      stack = StackManager.updateNode(stack, 'feat/branch-1', {
        status: 'merged',
        lastKnownHead: tombstone,
      });

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      // The merged node itself has children → Merged badge, cascade action
      const branch1 = result.nodes.get('feat/branch-1')!;
      expect(branch1.situation).toBe('parent-merged');
      expect(branch1.badge!.label).toBe('Merged');
      expect(branch1.primaryAction!.id).toBe('cascade-merged');

      // The child sees its parent is merged AND the tombstone isn't in its ancestry
      // (child branched before squash-merge, so the squash commit is unreachable).
      // This is parent-merged-drifted — needs drift reconciliation, which is exactly
      // what cascadeRebase with cherryPickReconcile handles.
      const branch2 = result.nodes.get('feat/branch-2')!;
      expect(branch2.situation).toBe('parent-merged-drifted');
      expect(branch2.primaryAction!.id).toBe('cascade-merged');

      // Banner should indicate merged branches
      expect(result.banner!.kind).toBe('merged');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('local/remote diverged — force push from another machine', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 1);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Make a local commit on branch-1
      r.git('checkout', 'feat/branch-1');
      await commit(r.dir, r.git, 'local-only.txt', 'local\n', 'local commit');
      r.git('push', 'origin', 'feat/branch-1', '--force');

      // Another local commit without pushing
      await commit(r.dir, r.git, 'local-2.txt', 'local2\n', 'local commit 2');

      // Simulate someone else force-pushing a different commit to the same branch
      r.git('checkout', 'main');
      r.git('checkout', '-b', 'temp-branch');
      await commit(r.dir, r.git, 'remote-only.txt', 'remote\n', 'remote commit');
      r.git('push', 'origin', 'temp-branch:feat/branch-1', '--force');
      r.git('checkout', 'main');
      r.git('branch', '-D', 'temp-branch');

      // Fetch to see the diverged remote
      r.git('fetch', 'origin');

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      const branch1 = result.nodes.get('feat/branch-1')!;
      expect(branch1.situation).toBe('local-remote-diverged');
      expect(branch1.badge!.label).toBe('Diverged');
      expect(branch1.primaryAction!.id).toBe('reset-to-remote');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('branch deleted on remote — remote branch gone', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 1);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Delete the branch on remote
      r.git('push', 'origin', '--delete', 'feat/branch-1');
      r.git('fetch', 'origin', '--prune');

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      const branch1 = result.nodes.get('feat/branch-1')!;
      expect(branch1.situation).toBe('branch-deleted-remote');
      expect(branch1.badge!.label).toBe('Deleted');
      expect(branch1.primaryAction!.id).toBe('remove-branch');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('dirty working tree — global block applied', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 1);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Dirty the working tree
      await writeFile(join(r.dir, 'dirty.txt'), 'uncommitted\n');

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      expect(snapshot.isDirty).toBe(true);
      expect(result.globalBlocks).toContain('Working tree has uncommitted changes');

      const branch1 = result.nodes.get('feat/branch-1')!;
      expect(branch1.blocked).not.toBeNull();
      expect(branch1.blocked!.reason).toContain('uncommitted');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('mid-stack amend — parent advanced, child behind', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack } = await buildLinearStack(r.dir, r.git, 3);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Amend branch-1 (mid-stack edit)
      r.git('checkout', 'feat/branch-1');
      await commit(r.dir, r.git, 'mid-stack-amend.txt', 'amended\n', 'mid-stack amend');
      r.git('push', 'origin', 'feat/branch-1', '--force-with-lease');

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      // branch-2 should be behind its parent (branch-1 advanced)
      const branch2 = result.nodes.get('feat/branch-2')!;
      expect(branch2.situation).toBe('behind-parent');
      expect(branch2.primaryAction!.id).toBe('sync-stack');

      // branch-3 is still up-to-date with branch-2 since branch-2 wasn't rewritten
      const branch3 = result.nodes.get('feat/branch-3')!;
      expect(branch3.situation).toBe('synced');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('local-only branch — unpublished', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      r.git('push', 'origin', 'main');

      // Create a branch but don't push it
      r.git('checkout', '-b', 'feat/unpublished');
      await commit(r.dir, r.git, 'local.txt', 'local\n', 'local commit');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/unpublished', 'main');
      // status defaults to 'local-only' — exactly correct for this test

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      const unpub = result.nodes.get('feat/unpublished')!;
      expect(unpub.situation).toBe('local-only');
      expect(unpub.badge!.label).toBe('Local');
      expect(unpub.primaryAction!.id).toBe('publish-stack');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('complex stack — mixed situations across branches', async () => {
    const r = await createSandboxRepoWithRemote();
    try {
      let { stack, shas } = await buildLinearStack(r.dir, r.git, 4);
      r.git('push', 'origin', 'main');
      pushAll(r, stack);
      stack = markAllSynced(stack);

      // Simulate squash-merge of branch-1 into main
      r.git('checkout', 'main');
      r.git('merge', '--squash', 'feat/branch-1');
      r.git('commit', '-m', 'squash-merge branch-1');
      r.git('push', 'origin', 'main');

      stack = StackManager.updateNode(stack, 'feat/branch-1', {
        status: 'merged',
        lastKnownHead: shas.get('feat/branch-1')!,
      });

      // Advance main further
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'extra.txt', 'extra\n', 'extra main commit');
      r.git('push', 'origin', 'main');

      const snapshot = await collectSnapshot(r.dir, stack);
      const result = diagnoseStack(snapshot, stack);

      // branch-1 is merged with children → cascade action
      const branch1 = result.nodes.get('feat/branch-1')!;
      expect(branch1.situation).toBe('parent-merged');
      expect(branch1.badge!.label).toBe('Merged');

      // branch-2's parent is merged
      const branch2 = result.nodes.get('feat/branch-2')!;
      expect(branch2.situation).toBe('parent-merged');

      // Banner should be non-null
      expect(result.banner).not.toBeNull();
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });
});
