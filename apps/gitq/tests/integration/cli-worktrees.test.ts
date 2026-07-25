import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createSandboxRepoWithRemote, addNamedWorktree } from './helpers.ts';

const GITQ_ROOT = join(import.meta.dir, '..', '..');
const cleanups: string[] = [];
let configDir: string;

function freshConfigDir(): void {
  configDir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-cliwt-')));
  cleanups.push(configDir);
}

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

function gitq(cwd: string, ...args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bun', ['bin/gitq', '-C', cwd, ...args, '--json'], {
      cwd: GITQ_ROOT,
      env: { ...process.env, GITQ_CONFIG_DIR: configDir },
      stdio: 'pipe',
    }).toString();
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

async function conflictStack(name: string, repo: Awaited<ReturnType<typeof createSandboxRepoWithRemote>>, file: string) {
  const { dir, git } = repo;
  git('checkout', '-b', `${name}-branch`, 'main');
  await writeFile(join(dir, file), `${name} local\n`);
  git('add', '.');
  git('commit', '-m', `${name} edit`);
  git('checkout', 'main');
  gitq(dir, 'track', name, '--root', 'main');
  gitq(dir, 'add', `${name}-branch`, '--parent', 'main', '--stack', name);
}

describe('CLI in a worktree pool', () => {
  test('sync leases a work slot, pauses there, and continue works from a DIFFERENT worktree', async () => {
    freshConfigDir();
    const repo = await createSandboxRepoWithRemote();
    cleanups.push(repo.dir, repo.remoteDir);
    const { dir, git } = repo;
    await writeFile(join(dir, 'a.txt'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('push', '-u', 'origin', 'main');
    await conflictStack('one', repo, 'a.txt');
    git('checkout', '-b', 'up', 'main');
    await writeFile(join(dir, 'a.txt'), 'upstream\n');
    git('commit', '-am', 'up');
    git('push', 'origin', 'up:main');
    git('checkout', 'main');
    git('branch', '-D', 'up');
    const otherSlot = await addNamedWorktree(repo, 'hermione');
    cleanups.push(otherSlot);

    const sync = gitq(dir, 'sync', '--stack', 'one');
    expect(sync.code).toBe(2);
    const payload = JSON.parse(sync.stdout);
    expect(payload.pauseInfo.worktreePath).toBeTruthy();
    const workDir: string = payload.pauseInfo.worktreePath;
    expect(workDir).not.toBe(dir);
    // The leased work slot lives outside dir/otherSlot/remoteDir (it's a
    // freshly provisioned worktree, e.g. sibling gitq-1) — clean it up too,
    // otherwise it's an orphaned worktree once repo.dir is removed below,
    // and a stale gitq-1 left in a shared pool root would break the next run.
    cleanups.push(workDir);

    // The launch worktree is untouched and NOT mid-rebase; the work slot is.
    expect(repo.git('branch', '--show-current')).toBe('main');

    // A second mutation on the SAME stack is refused per-stack.
    const blocked = gitq(dir, 'add', 'zzz', '--parent', 'main', '--stack', 'one');
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain('lease');

    // Resolve in the work slot, then continue from an UNRELATED worktree.
    await writeFile(join(workDir, 'a.txt'), 'upstream, one local\n');
    repo.git('-C', workDir, 'add', 'a.txt');
    const cont = gitq(otherSlot, 'continue');
    expect(cont.code).toBe(0);
    expect(repo.git('rev-parse', 'one-branch^')).toBe(repo.git('rev-parse', 'origin/main'));

    // Lease released: the same stack mutates freely again (untrack succeeds).
    const after = gitq(dir, 'untrack', 'one');
    expect(after.code).toBe(0);
    expect(after.stderr).not.toContain('lease');
  });

  test('two stacks cascade on two slots; a third is refused at the cap', async () => {
    freshConfigDir();
    // Cap the pool at 2 for this test.
    await writeFile(join(configDir, 'settings.json'), JSON.stringify({ maxWorkSlots: 2 }));
    const repo = await createSandboxRepoWithRemote();
    cleanups.push(repo.dir, repo.remoteDir);
    const { dir, git } = repo;
    await writeFile(join(dir, 'a.txt'), 'base a\n');
    await writeFile(join(dir, 'b.txt'), 'base b\n');
    await writeFile(join(dir, 'c.txt'), 'base c\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('push', '-u', 'origin', 'main');
    await conflictStack('one', repo, 'a.txt');
    await conflictStack('two', repo, 'b.txt');
    await conflictStack('three', repo, 'c.txt');
    git('checkout', '-b', 'up', 'main');
    await writeFile(join(dir, 'a.txt'), 'up a\n');
    await writeFile(join(dir, 'b.txt'), 'up b\n');
    await writeFile(join(dir, 'c.txt'), 'up c\n');
    git('commit', '-am', 'up all');
    git('push', 'origin', 'up:main');
    git('checkout', 'main');
    git('branch', '-D', 'up');

    const syncOne = gitq(dir, 'sync', '--stack', 'one');
    expect(syncOne.code).toBe(2);
    const syncTwo = gitq(dir, 'sync', '--stack', 'two');
    expect(syncTwo.code).toBe(2);
    const third = gitq(dir, 'sync', '--stack', 'three');
    expect(third.code).toBe(1);
    expect(third.stderr).toContain('work slots');

    // The two leased work slots live outside dir/remoteDir (freshly
    // provisioned worktrees under the pool's cache root) — clean them up so
    // a stale slot doesn't collide with the next run of this test.
    cleanups.push(JSON.parse(syncOne.stdout).pauseInfo.worktreePath);
    cleanups.push(JSON.parse(syncTwo.stdout).pauseInfo.worktreePath);

    // Aborting one frees its slot for the third stack.
    expect(gitq(dir, 'abort', '--stack', 'one').code).toBe(0);
    const syncThree = gitq(dir, 'sync', '--stack', 'three');
    expect(syncThree.code).toBe(2);
    cleanups.push(JSON.parse(syncThree.stdout).pauseInfo.worktreePath);
    gitq(dir, 'abort', '--stack', 'two');
    gitq(dir, 'abort', '--stack', 'three');
  });
});
