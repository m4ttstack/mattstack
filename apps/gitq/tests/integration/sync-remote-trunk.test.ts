import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSandboxRepo, createSandboxRepoWithRemote, cleanupRepo, commit } from './helpers.ts';

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

/** Sandbox repo plus a sibling config dir, both registered for cleanup. */
function withConfigDir<T extends { dir: string }>(repo: T): { repo: T; configDir: string } {
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  return { repo, configDir };
}

describe('gitq sync when the remote trunk ref does not resolve', () => {
  test('stack root never pushed: exits 1, names the ref, rebases nothing', async () => {
    const { repo, configDir } = withConfigDir(await createSandboxRepoWithRemote());
    dirsToClean.push(repo.remoteDir);

    // origin has main (the bare clone), but never this root.
    repo.git('checkout', '-b', 'develop');
    repo.git('checkout', '-b', 'feat/a');
    await commit(repo.dir, repo.git, 'a.txt', 'a data\n', 'feat/a: commit');
    repo.git('checkout', 'develop');
    const headBefore = repo.git('rev-parse', 'feat/a');

    await runCli(['track', 'demo', '--root', 'develop'], repo.dir, configDir);
    await runCli(['add', 'feat/a', '--parent', 'develop'], repo.dir, configDir);

    const sync = await runCli(['sync'], repo.dir, configDir);
    expect(sync.exitCode).toBe(1);
    expect(sync.stderr).toContain('gitq: cannot sync: origin/develop does not resolve after fetching origin');
    expect(sync.stderr).toContain('remote "origin" has no branch "develop"');
    expect(sync.stderr).toContain('git push -u origin develop');
    expect(sync.stdout).toBe('');
    expect(repo.git('rev-parse', 'feat/a')).toBe(headBefore);

    // Under --json a hard failure still prints nothing on stdout.
    const jsonSync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(jsonSync.exitCode).toBe(1);
    expect(jsonSync.stdout).toBe('');
    // Identical failure the second time: the first one released its lease
    // rather than leaving the stack wedged behind a running lease.
    expect(jsonSync.stderr).toContain('cannot sync: origin/develop does not resolve');
  });

  test('no remote named origin: exits 1 and says so', async () => {
    const { repo, configDir } = withConfigDir(await createSandboxRepo());

    // `git fetch origin` falls back to reading "origin" as a path when no
    // remote carries that name, so a bare repo at ./origin is what makes the
    // fetch succeed with the remote genuinely absent. A remote-less repo the
    // ordinary way never reaches here: its fetch fails first.
    execFileSync('git', ['clone', '--bare', repo.dir, join(repo.dir, 'origin')], { stdio: 'pipe' });

    repo.git('checkout', '-b', 'feat/a');
    await commit(repo.dir, repo.git, 'a.txt', 'a data\n', 'feat/a: commit');
    repo.git('checkout', 'main');

    await runCli(['track', 'demo', '--root', 'main'], repo.dir, configDir);
    await runCli(['add', 'feat/a', '--parent', 'main'], repo.dir, configDir);

    const sync = await runCli(['sync'], repo.dir, configDir);
    expect(sync.exitCode).toBe(1);
    expect(sync.stderr).toContain('gitq: cannot sync: origin/main does not resolve after fetching origin');
    expect(sync.stderr).toContain('no remote named "origin"');
  });

  test('nothing to sync is still exit 0, and distinguishable from the failure', async () => {
    const { repo, configDir } = withConfigDir(await createSandboxRepoWithRemote());
    dirsToClean.push(repo.remoteDir);

    repo.git('checkout', '-b', 'feat/a');
    await commit(repo.dir, repo.git, 'a.txt', 'a data\n', 'feat/a: commit');
    repo.git('checkout', 'main');

    await runCli(['track', 'demo', '--root', 'main'], repo.dir, configDir);
    await runCli(['add', 'feat/a', '--parent', 'main'], repo.dir, configDir);

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(0);
    const parsed = JSON.parse(sync.stdout);
    expect(parsed.state).toBe('completed');
    expect(parsed.results.every((r: { success: boolean }) => r.success)).toBe(true);
    expect(sync.stderr).not.toContain('cannot sync');
  });
});
