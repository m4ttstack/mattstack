import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import {
  createSandboxRepoWithRemote,
  cleanupRepo,
  commit,
  type SandboxRepoWithRemote,
} from './helpers.ts';

mock.restore();

let repo: SandboxRepoWithRemote;

beforeAll(async () => {
  repo = await createSandboxRepoWithRemote();
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
  await cleanupRepo(repo.remoteDir);
});

describe('GitShell.pushForceWithLease integration', () => {
  test('pushes a branch to the remote', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepoWithRemote();
    try {
      r.git('checkout', '-b', 'feat/push-test');
      await commit(r.dir, r.git, 'push.txt', 'data\n', 'push commit');
      r.git('push', '-u', 'origin', 'feat/push-test');

      // Add another commit and force-push
      await commit(r.dir, r.git, 'push2.txt', 'more\n', 'second commit');

      await GitShell.pushForceWithLease(r.dir, 'feat/push-test');

      // Verify the remote has the new commit
      const localHead = r.git('rev-parse', 'feat/push-test');
      const remoteHead = r.git('ls-remote', 'origin', 'feat/push-test');
      expect(remoteHead).toContain(localHead);
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('force-push succeeds after rebase rewrites history', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepoWithRemote();
    try {
      // Create and push a feature branch
      r.git('checkout', '-b', 'feat/rebase-push');
      await commit(r.dir, r.git, 'feature.txt', 'feature\n', 'feature commit');
      r.git('push', '-u', 'origin', 'feat/rebase-push');
      const headBefore = r.git('rev-parse', 'HEAD');

      // Advance main and rebase
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-advance.txt', 'advance\n', 'advance main');
      r.git('push', 'origin', 'main');

      const forkPoint = r.git('merge-base', 'main', 'feat/rebase-push');
      await GitShell.rebaseOnto(r.dir, 'main', forkPoint, 'feat/rebase-push');
      const headAfter = r.git('rev-parse', 'HEAD');

      // History was rewritten
      expect(headAfter).not.toBe(headBefore);

      // Force-push with lease should succeed (remote matches what we last pushed)
      await GitShell.pushForceWithLease(r.dir, 'feat/rebase-push');

      const remoteHead = r.git('ls-remote', 'origin', 'feat/rebase-push');
      expect(remoteHead).toContain(headAfter);
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });

  test('force-push with lease rejects when remote has diverged', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepoWithRemote();
    try {
      // Create and push a branch
      r.git('checkout', '-b', 'feat/lease-test');
      await commit(r.dir, r.git, 'lease.txt', 'v1\n', 'initial');
      r.git('push', '-u', 'origin', 'feat/lease-test');

      // Simulate someone else pushing to the same branch by pushing directly to the bare remote
      const { execFileSync } = await import('node:child_process');
      const cloneDir = (await import('node:fs/promises')).default
        ? r.remoteDir
        : r.remoteDir;

      // Clone the remote into a second working copy, make a commit, push
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const otherDir = await mkdtemp(join(tmpdir(), 'gitq-other-'));
      execFileSync('git', ['clone', r.remoteDir, otherDir], { stdio: 'pipe' });
      execFileSync('git', ['checkout', 'feat/lease-test'], { cwd: otherDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'other@gitq.dev'], { cwd: otherDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'Other'], { cwd: otherDir, stdio: 'pipe' });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(otherDir, 'other.txt'), 'other\n', 'utf-8');
      execFileSync('git', ['add', '.'], { cwd: otherDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'other commit'], { cwd: otherDir, stdio: 'pipe' });
      execFileSync('git', ['push', 'origin', 'feat/lease-test'], { cwd: otherDir, stdio: 'pipe' });

      // Now our local is behind remote — force-push with lease should fail
      await commit(r.dir, r.git, 'local.txt', 'local\n', 'local diverge');

      await expect(
        GitShell.pushForceWithLease(r.dir, 'feat/lease-test'),
      ).rejects.toThrow();

      await cleanupRepo(otherDir);
    } finally {
      await cleanupRepo(r.dir);
      await cleanupRepo(r.remoteDir);
    }
  });
});
