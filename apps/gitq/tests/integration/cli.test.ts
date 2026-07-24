import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo } from './helpers.ts';

const BIN = join(import.meta.dir, '../../bin/gitq');

export async function runCli(args: string[], cwd: string, configDir: string) {
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

// Dirs created by makeRepo() in the current test, cleaned up in afterEach.
// Tests added later in this file inherit cleanup for free by going through makeRepo().
let dirsToClean: string[] = [];

/** Create a sandbox repo + sibling config dir, registering both for afterEach cleanup. */
async function makeRepo() {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  return { repo, configDir };
}

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
});

describe('gitq CLI', () => {
  test('stacks --json on a repo with no stacks', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['stacks', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
  });

  test('unknown command exits 1', async () => {
    const { repo, configDir } = await makeRepo();
    const { exitCode, stderr } = await runCli(['nonsense'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown command');
  });

  test('-C <repoDir> resolves context from a different cwd', async () => {
    const { repo, configDir } = await makeRepo();
    // Assumes the temp dir's parent (join(repo.dir, '..')) is not itself inside a git repo,
    // otherwise `-C` context resolution could pick up that outer repo instead.
    const { stdout, exitCode } = await runCli(['-C', repo.dir, 'stacks', '--json'], join(repo.dir, '..'), configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
  });
});
