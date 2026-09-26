/**
 * Two reporting gaps found running gitq against a 19-branch stack across a
 * six-stack repo: finished stacks that never stopped being reported branch by
 * branch, and a paused cascade whose conflict list was printed once and then
 * unrecoverable.
 */

import { describe, test, expect, mock } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { StackManager } from '../../src/core/stack-manager.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore } from '../../src/core/persistence.ts';
import { pausedDetail } from '../../src/cli/slots.ts';
import {
  createSandboxRepo,
  createSandboxRepoWithRemote,
  cleanupRepo,
  buildLinearStack,
  runCli,
  type SandboxRepoWithRemote,
} from './helpers.ts';
import type { Stack } from '../../src/core/types.ts';

mock.restore();

function pushAll(r: SandboxRepoWithRemote, stack: Stack): void {
  for (const node of stack.nodes) r.git('push', 'origin', node.branch);
}

/** What forge-sync leaves behind after a publish. */
function markAllSynced(stack: Stack): Stack {
  let s = stack;
  for (const node of stack.nodes) {
    if (node.status === 'local-only') s = StackManager.updateNode(s, node.branch, { status: 'synced' });
  }
  return s;
}

describe('gitq diagnose on a stack whose branches are all gone from the remote', () => {
  /** Publish a linear stack, then delete `deleteCount` of its branches on the remote. */
  async function repoWithDeletedBranches(total: number, deleteCount: number) {
    const r = await createSandboxRepoWithRemote();
    const configDir = `${r.dir}-config`;
    let { stack } = await buildLinearStack(r.dir, r.git, total);
    r.git('push', 'origin', 'main');
    pushAll(r, stack);
    stack = markAllSynced(stack);

    for (let i = 1; i <= deleteCount; i++) r.git('push', 'origin', '--delete', `feat/branch-${i}`);
    r.git('fetch', 'origin', '--prune');

    setConfigDir(configDir);
    await saveStore(r.dir, { repoPath: r.dir, remoteUrl: '', stacks: [stack] });
    return { r, configDir };
  }

  test('collapses to one untrack line instead of repeating every dead branch', async () => {
    const { r, configDir } = await repoWithDeletedBranches(2, 2);
    try {
      const { stdout, exitCode } = await runCli(['diagnose'], r.dir, configDir);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(
        `test-stack: all 2 branches gone from the remote — gitq untrack test-stack`,
      );
      expect(stdout).not.toContain('branch-deleted-remote');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
      await cleanupRepo(configDir);
    }
  });

  test('--json keeps every node, and flags the stack for the board', async () => {
    const { r, configDir } = await repoWithDeletedBranches(2, 2);
    try {
      const { stdout } = await runCli(['diagnose', '--json'], r.dir, configDir);
      const parsed = JSON.parse(stdout);

      // Collapsing is a rendering choice; the machine contract must not lose
      // the per-branch detail the board renders from.
      expect(parsed.stacks[0].allBranchesGone).toBe(true);
      expect(parsed.stacks[0].diagnostics.nodes).toHaveLength(2);
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
      await cleanupRepo(configDir);
    }
  });

  test('one surviving branch keeps the stack expanded', async () => {
    const { r, configDir } = await repoWithDeletedBranches(2, 1);
    try {
      const { stdout } = await runCli(['diagnose'], r.dir, configDir);

      expect(stdout).toContain('branch-deleted-remote');
      expect(stdout).not.toContain('gone from the remote — gitq untrack');
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
      await cleanupRepo(configDir);
    }
  });
});

describe('what a held lease says is blocking', () => {
  async function slotWithPause(pauseInfo: unknown): Promise<{ dir: string; slot: string }> {
    const repo = await createSandboxRepo();
    const slot = realpathSync(await mkdtemp(join(tmpdir(), 'gitq-slot-')));
    execFileSync('git', ['worktree', 'add', '--detach', slot, 'HEAD'], {
      cwd: repo.dir,
      stdio: 'pipe',
    });
    if (pauseInfo !== null) {
      const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: slot,
        stdio: 'pipe',
      })
        .toString()
        .trim();
      await writeFile(
        join(gitDir, 'gitq-pause.json'),
        JSON.stringify({ stackId: 's1', pauseInfo }),
        'utf-8',
      );
    }
    return { dir: repo.dir, slot };
  }

  test('names the branch and the conflicted files, with their status codes', async () => {
    const { dir, slot } = await slotWithPause({
      currentBranch: 'feat/child',
      conflictFiles: ['src/a.ts', 'src/b.ts'],
      conflictTypes: [
        { file: 'src/a.ts', type: 'UU' },
        { file: 'src/b.ts', type: 'UD' },
      ],
      remainingBranches: [],
      completedBranches: [],
      mergedBranch: null,
      newBase: 'main',
    });
    try {
      const detail = await pausedDetail(slot);

      expect(detail).toContain('paused on feat/child, 2 conflicts:');
      expect(detail).toContain('UU src/a.ts');
      expect(detail).toContain('UD src/b.ts');
    } finally {
      await cleanupRepo(dir);
      await cleanupRepo(slot);
    }
  });

  test('falls back to the bare file list when no status codes were captured', async () => {
    const { dir, slot } = await slotWithPause({
      currentBranch: 'feat/child',
      conflictFiles: ['src/only.ts'],
      remainingBranches: [],
      completedBranches: [],
      mergedBranch: null,
      newBase: 'main',
    });
    try {
      const detail = await pausedDetail(slot);

      expect(detail).toContain('paused on feat/child, 1 conflict:');
      expect(detail).toContain('src/only.ts');
    } finally {
      await cleanupRepo(dir);
      await cleanupRepo(slot);
    }
  });

  test('says nothing extra for a running lease, which has no pause file', async () => {
    const { dir, slot } = await slotWithPause(null);
    try {
      // A refusal is not the place to fail over a missing pause file: a
      // running cascade holds a lease and has not paused at all.
      expect(await pausedDetail(slot)).toBe('');
    } finally {
      await cleanupRepo(dir);
      await cleanupRepo(slot);
    }
  });
});
