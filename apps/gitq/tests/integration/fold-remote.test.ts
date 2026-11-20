import { afterEach, describe, expect, test } from 'bun:test';
import { cleanupRepo, commit, createSandboxRepoWithRemote, runCli, type SandboxRepoWithRemote } from './helpers.ts';

let dirsToClean: string[] = [];

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
});

/** main -> a -> b, both pushed to origin. */
async function pushedStack(): Promise<{ repo: SandboxRepoWithRemote; configDir: string }> {
  const repo = await createSandboxRepoWithRemote();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, repo.remoteDir, configDir);

  repo.git('checkout', '-b', 'a');
  await commit(repo.dir, repo.git, 'a.txt', 'a\n', 'a1');
  repo.git('checkout', '-b', 'b');
  await commit(repo.dir, repo.git, 'b.txt', 'b\n', 'b1');
  repo.git('checkout', 'main');
  repo.git('push', '-q', 'origin', 'a', 'b');

  await runCli(['track', 's', '--root', 'main'], repo.dir, configDir);
  await runCli(['add', 'a', '--parent', 'main'], repo.dir, configDir);
  await runCli(['add', 'b', '--parent', 'a'], repo.dir, configDir);
  return { repo, configDir };
}

describe('fold reports what it leaves on the forge', () => {
  test('names the remote branch and how to close it', async () => {
    const { repo, configDir } = await pushedStack();

    const res = await runCli(['fold', 'b'], repo.dir, configDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('origin/b still exists');
    expect(res.stdout).toContain('gitq fold --close-remote');
  });

  test('--json carries the leftovers', async () => {
    const { repo, configDir } = await pushedStack();

    const res = await runCli(['fold', 'b', '--json'], repo.dir, configDir);
    expect(JSON.parse(res.stdout).leftovers).toEqual({ branch: 'b', mrIid: null, mrUrl: null, remoteBranch: true });
  });

  test('--close-remote with no forge access refuses before folding anything', async () => {
    const { repo, configDir } = await pushedStack();

    const res = await runCli(['fold', 'b', '--close-remote'], repo.dir, configDir, { GITLAB_TOKEN: undefined, GITHUB_TOKEN: undefined });
    expect(res.exitCode).toBe(1);
    expect(repo.git('branch', '--list', 'b')).toContain('b');
  });
});
