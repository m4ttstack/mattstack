import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSandboxRepoWithRemote, cleanupRepo, commit } from './helpers.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore } from '../../src/core/persistence.ts';
import { StackManager } from '../../src/core/stack-manager.ts';

const BIN = join(import.meta.dir, '../../bin/gitq');

let dirsToClean: string[] = [];

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
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

/** Read a branch's sha from the bare remote, the only source of truth here. */
function remoteSha(remoteDir: string, branch: string): string {
  return execFileSync('git', ['-C', remoteDir, 'rev-parse', branch], { stdio: 'pipe' }).toString().trim();
}

/**
 * A stack of one published branch (`feat/a`, mrIid 1) whose remote sits on the
 * original commit while the local branch has moved past it. That is the
 * post-restack state: local moved, the MR still points at the old commit.
 */
async function makePublishedDivergedStack() {
  const repo = await createSandboxRepoWithRemote();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir, repo.remoteDir);
  setConfigDir(configDir);

  repo.git('checkout', '-b', 'feat/a');
  await commit(repo.dir, repo.git, 'a.txt', 'one\n', 'feat/a: add a.txt');
  repo.git('push', 'origin', 'feat/a');
  const publishedSha = repo.git('rev-parse', 'feat/a');

  await commit(repo.dir, repo.git, 'a.txt', 'two\n', 'feat/a: second commit');
  const localSha = repo.git('rev-parse', 'feat/a');
  repo.git('checkout', 'main');

  let stack = StackManager.createStack('demo', 'main');
  stack = StackManager.addNode(stack, 'feat/a', 'main');
  stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'synced', lastKnownHead: localSha });
  await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });

  return { repo, configDir, publishedSha, localSha };
}

describe('gitq push', () => {
  test('pushes a published branch whose remote is behind', async () => {
    const { repo, configDir, publishedSha, localSha } = await makePublishedDivergedStack();
    expect(remoteSha(repo.remoteDir, 'feat/a')).toBe(publishedSha);

    const { stdout, exitCode } = await runCli(['push'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('feat/a: pushed');
    expect(remoteSha(repo.remoteDir, 'feat/a')).toBe(localSha);
  });

  test('a second push reports already current and pushes nothing', async () => {
    const { repo, configDir, localSha } = await makePublishedDivergedStack();
    await runCli(['push'], repo.dir, configDir);

    const { stdout, exitCode } = await runCli(['push'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('already current');
    expect(remoteSha(repo.remoteDir, 'feat/a')).toBe(localSha);
  });

  test('--preview names the branch and leaves the remote untouched', async () => {
    const { repo, configDir, publishedSha } = await makePublishedDivergedStack();

    const { stdout, exitCode } = await runCli(['push', '--preview'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('feat/a');
    expect(remoteSha(repo.remoteDir, 'feat/a')).toBe(publishedSha);
  });

  test('a merged node and an MR-less node are skipped with their reasons', async () => {
    const { repo, configDir } = await makePublishedDivergedStack();
    repo.git('checkout', '-b', 'feat/local', 'feat/a');
    await commit(repo.dir, repo.git, 'l.txt', 'l\n', 'feat/local: add l.txt');
    repo.git('checkout', 'main');

    let stack = StackManager.createStack('demo', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { mrIid: 1, status: 'merged' });
    stack = StackManager.addNode(stack, 'feat/local', 'feat/a');
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });

    const { stdout, exitCode } = await runCli(['push', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const byBranch = Object.fromEntries(
      JSON.parse(stdout).results.map((r: { branch: string; action: string; detail?: string }) => [r.branch, r]),
    );
    expect(byBranch['feat/a']).toMatchObject({ action: 'skipped', detail: 'merged' });
    expect(byBranch['feat/local'].detail).toContain('gitq publish');
  });

  test('a branch the remote moved under is rejected, and nothing is pushed', async () => {
    const { repo, configDir, publishedSha } = await makePublishedDivergedStack();

    // Someone else advances origin/feat/a. Our remote-tracking ref still points
    // at publishedSha, so the lease has to catch this.
    const clone = await mkdtemp(join(tmpdir(), 'gitq-ext-'));
    dirsToClean.push(clone);
    execFileSync('git', ['clone', repo.remoteDir, clone], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'ext@gitq.dev'], { cwd: clone, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'External'], { cwd: clone, stdio: 'pipe' });
    execFileSync('git', ['checkout', 'feat/a'], { cwd: clone, stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'ext: move feat/a'], { cwd: clone, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'feat/a'], { cwd: clone, stdio: 'pipe' });
    const theirSha = remoteSha(repo.remoteDir, 'feat/a');
    expect(theirSha).not.toBe(publishedSha);

    const { stdout, exitCode } = await runCli(['push'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('REJECTED');
    expect(remoteSha(repo.remoteDir, 'feat/a')).toBe(theirSha);
  });
});
