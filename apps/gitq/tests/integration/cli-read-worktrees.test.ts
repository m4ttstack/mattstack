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

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

function gitq(cwd: string, ...args: string[]): { code: number; stdout: string } {
  configDir ??= realpathSync(mkdtempSync(join(tmpdir(), 'gitq-read-')));
  try {
    const stdout = execFileSync('bun', ['bin/gitq', '-C', cwd, ...args, '--json'], {
      cwd: GITQ_ROOT,
      env: { ...process.env, GITQ_CONFIG_DIR: configDir },
      stdio: 'pipe',
    }).toString();
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer };
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '' };
  }
}

test('stacks and diagnose surface the worktree map and per-branch owners', async () => {
  const repo = await createSandboxRepoWithRemote();
  cleanups.push(repo.dir, repo.remoteDir);
  const { dir, git } = repo;
  await writeFile(join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-m', 'base');
  git('push', '-u', 'origin', 'main');
  git('checkout', '-b', 'feat', 'main');
  git('checkout', 'main');
  const dobby = await addNamedWorktree(repo, 'dobby', 'feat');
  cleanups.push(dobby);
  await writeFile(join(dobby, 'wip.txt'), 'wip\n');
  gitq(dir, 'track', 's', '--root', 'main');
  gitq(dir, 'add', 'feat', '--parent', 'main');

  const stacks = JSON.parse(gitq(dir, 'stacks').stdout);
  const dobbySlot = stacks.worktrees.find((w: { branch: string | null }) => w.branch === 'feat');
  expect(dobbySlot.dirty).toBe(true);
  expect(dobbySlot.lease).toBeNull();

  const diagnose = JSON.parse(gitq(dir, 'diagnose').stdout);
  const feat = diagnose.stacks[0].diagnostics.nodes.find((n: { branch: string }) => n.branch === 'feat');
  expect(feat.checkedOutIn).toBe(dobbySlot.name);

  const preflight = JSON.parse(gitq(dir, 'preflight').stdout);
  const conflicts = preflight.stacks[0].slotConflicts;
  expect(conflicts).toEqual([{ branch: 'feat', slot: dobbySlot.name, dirty: true }]);
});
