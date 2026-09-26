import { describe, test, expect, afterEach } from 'bun:test';
import { basename, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSandboxRepoWithRemote, addNamedWorktree, cleanupRepo, commit } from './helpers.ts';
import type { SandboxRepoWithRemote } from './helpers.ts';
import { resetToRemote } from '../../src/core/branch-reset.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore } from '../../src/core/persistence.ts';
import type { Stack } from '../../src/core/types.ts';

const BIN = join(import.meta.dir, '../../bin/gitq');

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanupRepo(cleanups.pop()!);
});

async function runCli(args: string[], cwd: string, configDir: string) {
  const proc = Bun.spawn(['bun', BIN, ...args], {
    cwd,
    env: { ...process.env, GITQ_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * Stack: main -> feat/y, both pushed to origin, then feat/y diverged locally
 * with one extra commit (local.txt) that origin does not have — the exact
 * shape `gitq reset` exists to undo. The launch worktree is left on `main`.
 */
async function resetScenario(): Promise<{
  repo: SandboxRepoWithRemote; stack: Stack; remoteHead: string; configDir: string;
}> {
  const repo = await createSandboxRepoWithRemote();
  const configDir = `${repo.dir}-config`;
  cleanups.push(repo.dir, repo.remoteDir, configDir);
  const { dir, git } = repo;

  git('push', '-u', 'origin', 'main');
  git('checkout', '-b', 'feat/y');
  const remoteHead = await commit(dir, git, 'y.txt', 'y\n', 'feat/y: add y.txt');
  git('push', 'origin', 'feat/y');

  await commit(dir, git, 'local.txt', 'local\n', 'feat/y: local-only commit');
  git('checkout', 'main');

  let stack = StackManager.createStack('reset-neutrality', 'main');
  stack = StackManager.addNode(stack, 'feat/y', 'main');
  stack = StackManager.updateNode(stack, 'feat/y', { lastKnownHead: remoteHead });

  return { repo, stack, remoteHead, configDir };
}

/**
 * Add a real `gitq-N` work slot holding `branch`: the pool-managed kind
 * `findSlotForBranch` deliberately skips, so nothing downstream of the CLI
 * pre-guard notices it. Returns `{ path, root }`; `root` is what to clean up.
 */
function addWorkSlot(repo: SandboxRepoWithRemote, name: string, branch: string) {
  const root = `${repo.dir}-slots`;
  repo.git('worktree', 'add', join(root, name), branch);
  return { path: realpathSync(join(root, name)), root };
}

/** Trimmed `git` bound to an arbitrary worktree (slots have no helper). */
const gitIn = (dir: string) => (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();

describe('ref-only reset', () => {
  test('resets the branch without moving the launch checkout', async () => {
    const { repo, stack, remoteHead } = await resetScenario();
    const launchHead = repo.git('rev-parse', 'HEAD');

    const result = await resetToRemote(repo.dir, stack, 'feat/y');

    expect(result.newHead).toBe(remoteHead);
    expect(repo.git('rev-parse', 'feat/y')).toBe(remoteHead);
    // The launch worktree never moved: same branch, same sha, and the reset
    // branch's local-only file was never checked out into it.
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(existsSync(join(repo.dir, 'local.txt'))).toBe(false);
  });

  test('a launch worktree standing on the branch stays on it and follows the new head', async () => {
    const { repo, stack, remoteHead } = await resetScenario();
    repo.git('checkout', 'feat/y');

    await resetToRemote(repo.dir, stack, 'feat/y');

    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/y');
    expect(repo.git('rev-parse', 'HEAD')).toBe(remoteHead);
    expect(existsSync(join(repo.dir, 'local.txt'))).toBe(false);
    // The in-place reset leaves a genuinely clean tree, not just a deleted
    // file: no leftover staged deletion of local.txt in the index either.
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  test('recreates a missing local branch at the remote head, still without a checkout', async () => {
    const { repo, stack, remoteHead } = await resetScenario();
    const launchHead = repo.git('rev-parse', 'HEAD');
    repo.git('branch', '-D', 'feat/y');

    const result = await resetToRemote(repo.dir, stack, 'feat/y');

    expect(result.newHead).toBe(remoteHead);
    expect(repo.git('rev-parse', 'feat/y')).toBe(remoteHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
  });
});

describe('reset failure paths leave the checkout alone', () => {
  test('an unresolvable origin ref fails with nothing moved', async () => {
    const { repo } = await resetScenario();
    repo.git('checkout', '-b', 'feat/never-pushed');
    const branchHead = await commit(repo.dir, repo.git, 'z.txt', 'z\n', 'feat/never-pushed: add z');
    repo.git('checkout', 'main');
    const launchHead = repo.git('rev-parse', 'HEAD');

    let stack = StackManager.createStack('reset-fail', 'main');
    stack = StackManager.addNode(stack, 'feat/never-pushed', 'main');

    await expect(resetToRemote(repo.dir, stack, 'feat/never-pushed')).rejects.toThrow();

    expect(repo.git('rev-parse', 'feat/never-pushed')).toBe(branchHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
  });

  test('a dirty slot holding the branch refuses; ref and launch checkout unchanged', async () => {
    const { repo, stack } = await resetScenario();
    const slotPath = await addNamedWorktree(repo, 'y-slot', 'feat/y');
    cleanups.push(slotPath);
    await writeFile(join(slotPath, 'wip.txt'), 'wip\n', 'utf-8');
    const launchHead = repo.git('rev-parse', 'HEAD');
    const divergedHead = repo.git('rev-parse', 'feat/y');

    await expect(resetToRemote(repo.dir, stack, 'feat/y')).rejects.toThrow(/dirty|checked out/i);

    expect(repo.git('rev-parse', 'feat/y')).toBe(divergedHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
  });

  test('a branch outside the picked stack refuses with the ref unmoved', async () => {
    const { repo, stack } = await resetScenario();
    const { dir, git } = repo;
    git('checkout', '-b', 'feat/stray', 'main');
    git('push', 'origin', 'feat/stray');
    const strayHead = await commit(dir, git, 'stray.txt', 'stray\n', 'feat/stray: local-only commit');
    git('checkout', 'main');

    await expect(resetToRemote(dir, stack, 'feat/stray')).rejects.toThrow(/not tracked in stack/i);

    // The membership check runs before the CAS: origin/feat/stray resolves
    // fine, so without it the ref moved for real and only the store update
    // threw, leaving the branch reset by a command that exited 1.
    expect(git('rev-parse', 'feat/stray')).toBe(strayHead);
  });

  test('a dirty launch worktree refuses before anything moves', async () => {
    const { repo, stack } = await resetScenario();
    await writeFile(join(repo.dir, 'uncommitted.txt'), 'wip\n', 'utf-8');
    const launchHead = repo.git('rev-parse', 'HEAD');
    const divergedHead = repo.git('rev-parse', 'feat/y');

    // assertCleanTree fires first, so restoring a checkout could never land in
    // stash territory — there is nothing uncommitted for a reset to strand.
    await expect(resetToRemote(repo.dir, stack, 'feat/y')).rejects.toThrow(/uncommitted changes/i);

    expect(repo.git('rev-parse', 'feat/y')).toBe(divergedHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(repo.git('status', '--porcelain')).toContain('uncommitted.txt');
  });
});

describe('gitq reset (CLI) checkout neutrality', () => {
  test('a successful reset leaves you on the branch you launched from', async () => {
    const { repo, stack, remoteHead, configDir } = await resetScenario();
    setConfigDir(configDir);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
    const launchHead = repo.git('rev-parse', 'HEAD');

    const { stdout, exitCode } = await runCli(['reset', 'feat/y', '--json'], repo.dir, configDir);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).result.newHead).toBe(remoteHead);
    expect(repo.git('rev-parse', 'feat/y')).toBe(remoteHead);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
  });

  test('a gitq work slot holding the branch refuses instead of going stale', async () => {
    const { repo, stack, configDir } = await resetScenario();
    setConfigDir(configDir);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
    const slot = addWorkSlot(repo, 'gitq-1', 'feat/y');
    cleanups.push(slot.root);
    const divergedHead = repo.git('rev-parse', 'feat/y');

    const { stderr, exitCode } = await runCli(['reset', 'feat/y'], repo.dir, configDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('checked out in work slot "gitq-1"');
    expect(stderr).toContain(slot.path);
    // Nothing moved, and the slot is left exactly as the human had it.
    // Without this guard the command exited 0 with the slot's tree stale.
    expect(repo.git('rev-parse', 'feat/y')).toBe(divergedHead);
    expect(gitIn(slot.path)('rev-parse', 'HEAD')).toBe(divergedHead);
    expect(gitIn(slot.path)('status', '--porcelain')).toBe('');
  });

  test('a non-work worktree holding the branch refuses with the slot pre-guard message', async () => {
    const { repo, stack, configDir } = await resetScenario();
    setConfigDir(configDir);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
    const slotPath = await addNamedWorktree(repo, 'y-slot', 'feat/y');
    cleanups.push(slotPath);
    const divergedHead = repo.git('rev-parse', 'feat/y');

    const { stderr, exitCode } = await runCli(['reset', 'feat/y'], repo.dir, configDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`is checked out in slot "${basename(slotPath)}"`);
    expect(stderr).toContain(slotPath);
    expect(repo.git('rev-parse', 'feat/y')).toBe(divergedHead);
  });

  test('a failed reset leaves you on the branch you launched from', async () => {
    const { repo, configDir } = await resetScenario();
    repo.git('checkout', '-b', 'feat/never-pushed');
    await commit(repo.dir, repo.git, 'z.txt', 'z\n', 'feat/never-pushed: add z');
    repo.git('checkout', 'main');

    let stack = StackManager.createStack('reset-fail', 'main');
    stack = StackManager.addNode(stack, 'feat/never-pushed', 'main');
    setConfigDir(configDir);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
    const launchHead = repo.git('rev-parse', 'HEAD');

    const { exitCode } = await runCli(['reset', 'feat/never-pushed', '--json'], repo.dir, configDir);

    expect(exitCode).toBe(1);
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(repo.git('rev-parse', 'HEAD')).toBe(launchHead);
  });
});
