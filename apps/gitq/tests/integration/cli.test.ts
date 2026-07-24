import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSandboxRepo } from './helpers.ts';

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

describe('gitq CLI', () => {
  test('stacks --json on a repo with no stacks', async () => {
    const repo = await createSandboxRepo();
    const configDir = `${repo.dir}-config`;
    const { stdout, exitCode } = await runCli(['stacks', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
  });

  test('unknown command exits 1', async () => {
    const repo = await createSandboxRepo();
    const { exitCode, stderr } = await runCli(['nonsense'], repo.dir, `${repo.dir}-config`);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown command');
  });

  test('-C <repoDir> resolves context from a different cwd', async () => {
    const repo = await createSandboxRepo();
    const configDir = `${repo.dir}-config`;
    const { stdout, exitCode } = await runCli(['-C', repo.dir, 'stacks', '--json'], join(repo.dir, '..'), configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
  });
});
