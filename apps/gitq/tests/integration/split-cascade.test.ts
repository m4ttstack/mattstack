import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cleanupRepo, commit, createSandboxRepo, runCli, type SandboxRepo } from './helpers.ts';

let dirsToClean: string[] = [];

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
});

async function makeRepo(): Promise<{ repo: SandboxRepo; configDir: string }> {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  return { repo, configDir };
}

function contains(dir: string, ancestor: string, branch: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, branch], { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * main -> a (a1, a2, a3) -> platform, where platform forked from a2 and so
 * sits behind a's head.
 */
async function staleChildStack(repo: SandboxRepo, configDir: string): Promise<{ a1: string }> {
  repo.git('checkout', '-b', 'a');
  const a1 = await commit(repo.dir, repo.git, 'a1.txt', '1\n', 'a1');
  await commit(repo.dir, repo.git, 'a2.txt', '2\n', 'a2');
  repo.git('checkout', '-b', 'platform');
  await commit(repo.dir, repo.git, 'p1.txt', 'p\n', 'p1');
  repo.git('checkout', 'a');
  await commit(repo.dir, repo.git, 'a3.txt', '3\n', 'a3');
  repo.git('checkout', 'main');

  await runCli(['track', 's', '--root', 'main'], repo.dir, configDir);
  await runCli(['add', 'a', '--parent', 'main'], repo.dir, configDir);
  await runCli(['add', 'platform', '--parent', 'a'], repo.dir, configDir);
  return { a1 };
}

describe('split --at restacks the children it reparents', () => {
  test('a child moved under the new branch ends up on its head', async () => {
    const { repo, configDir } = await makeRepo();
    const { a1 } = await staleChildStack(repo, configDir);

    const split = await runCli(['split', 'a', '--at', a1, '--name', 'emma'], repo.dir, configDir);
    expect(split.stderr).toBe('');
    expect(split.exitCode).toBe(0);

    expect(contains(repo.dir, 'emma', 'platform')).toBe(true);
    expect(repo.git('log', '--format=%s', 'emma..platform')).toBe('p1');
    const { stacks } = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    const platform = stacks[0].nodes.find((n: { branch: string }) => n.branch === 'platform');
    expect(platform.parent).toBe('emma');
  });
});

describe('split --files with children', () => {
  test('names the children left on the old head and says to run sync', async () => {
    const { repo, configDir } = await makeRepo();
    await staleChildStack(repo, configDir);

    const split = await runCli(['split', 'a', '--files', 'a3.txt', '--name', 'emma'], repo.dir, configDir);
    expect(split.exitCode).toBe(0);
    expect(split.stdout).toContain('platform still sits on the old a; run gitq sync');
  });
});

describe('reparent onto the current parent', () => {
  test('rebases a branch that sits behind its parent instead of doing nothing', async () => {
    const { repo, configDir } = await makeRepo();
    await staleChildStack(repo, configDir);
    expect(contains(repo.dir, 'a', 'platform')).toBe(false);

    const res = await runCli(['reparent', 'platform', '--onto', 'a'], repo.dir, configDir);
    expect(res.exitCode).toBe(0);
    expect(contains(repo.dir, 'a', 'platform')).toBe(true);
  });

  test('an amended parent does not bring back the change it dropped', async () => {
    const { repo, configDir } = await makeRepo();
    repo.git('checkout', '-b', 'a');
    await commit(repo.dir, repo.git, 'obsolete.txt', 'old\n', 'a1');
    repo.git('checkout', '-b', 'b');
    await commit(repo.dir, repo.git, 'b.txt', 'b\n', 'b1');
    await runCli(['track', 's', '--root', 'main'], repo.dir, configDir);
    await runCli(['add', 'a', '--parent', 'main'], repo.dir, configDir);
    await runCli(['add', 'b', '--parent', 'a'], repo.dir, configDir);
    // A no-op restack records b's fork point, as any earlier gitq restack would have.
    await runCli(['reparent', 'b', '--onto', 'a'], repo.dir, configDir);

    repo.git('checkout', 'a');
    repo.git('rm', '-q', 'obsolete.txt');
    await commit(repo.dir, repo.git, 'correct.txt', 'new\n', 'a1 (amended)');
    repo.git('reset', '-q', '--soft', 'HEAD~2');
    repo.git('commit', '-q', '-m', 'a1 (amended)');
    repo.git('checkout', 'main');

    const res = await runCli(['reparent', 'b', '--onto', 'a'], repo.dir, configDir);
    expect(res.exitCode).toBe(0);
    expect(contains(repo.dir, 'a', 'b')).toBe(true);
    expect(repo.git('ls-tree', '--name-only', 'b')).not.toContain('obsolete.txt');
    expect(repo.git('log', '--format=%s', 'a..b')).toBe('b1');
  });

  test('with no fork point on record, an amended parent refuses rather than restoring the dropped change', async () => {
    const { repo, configDir } = await makeRepo();
    repo.git('checkout', '-b', 'a');
    await commit(repo.dir, repo.git, 'obsolete.txt', 'old\n', 'a1');
    repo.git('checkout', '-b', 'b');
    await commit(repo.dir, repo.git, 'b.txt', 'b\n', 'b1');
    await runCli(['track', 's', '--root', 'main'], repo.dir, configDir);
    await runCli(['add', 'a', '--parent', 'main'], repo.dir, configDir);
    await runCli(['add', 'b', '--parent', 'a'], repo.dir, configDir);

    repo.git('checkout', 'a');
    repo.git('rm', '-q', 'obsolete.txt');
    await commit(repo.dir, repo.git, 'correct.txt', 'new\n', 'a1 (amended)');
    repo.git('reset', '-q', '--soft', 'HEAD~2');
    repo.git('commit', '-q', '-m', 'a1 (amended)');
    repo.git('checkout', 'main');
    const before = repo.git('rev-parse', 'b');

    const res = await runCli(['reparent', 'b', '--onto', 'a'], repo.dir, configDir);
    if (res.exitCode === 0) {
      expect(repo.git('ls-tree', '--name-only', 'b')).not.toContain('obsolete.txt');
    } else {
      expect(repo.git('rev-parse', 'b')).toBe(before);
    }
  });

  test('says nothing moved when the branch is already on its parent', async () => {
    const { repo, configDir } = await makeRepo();
    await staleChildStack(repo, configDir);
    await runCli(['reparent', 'platform', '--onto', 'a'], repo.dir, configDir);

    const res = await runCli(['reparent', 'platform', '--onto', 'a'], repo.dir, configDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('platform is already on a');
  });
});
