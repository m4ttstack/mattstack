import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';
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

const sha = (dir: string, rev: string): string =>
  execFileSync('git', ['rev-parse', rev], { cwd: dir }).toString().trim();

const fileAt = (dir: string, rev: string, path: string): string =>
  execFileSync('git', ['show', `${rev}:${path}`], { cwd: dir }).toString();

const lines = (...replacements: [number, string][]): string => {
  const out = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
  for (const [index, value] of replacements) out[index - 1] = value;
  return `${out.join('\n')}\n`;
};

/**
 * The MAT-82 shape, minimal: one file both branches touch, in disjoint regions.
 *
 * `main` adds F.txt as L1..L10, `b1` rewrites L2, `b2` rewrites L9. File-level
 * attribution sees both branches touching F.txt and picks the deepest, b2, for
 * anything dirty in it, whichever region the dirt is actually in.
 *
 * Leaves the worktree checked out on b2.
 */
async function makeRegionStack(): Promise<{ dir: string; configDir: string; git: (...a: string[]) => string }> {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  setConfigDir(configDir);

  await commit(repo.dir, repo.git, 'F.txt', lines(), 'main: add F.txt');
  let stack = StackManager.createStack('regions', 'main');

  repo.git('checkout', '-b', 'b1');
  const b1 = await commit(repo.dir, repo.git, 'F.txt', lines([2, 'L2-from-b1']), 'b1: rewrite L2');
  stack = StackManager.addNode(stack, 'b1', 'main');
  stack = StackManager.updateNode(stack, 'b1', { lastKnownHead: b1 });

  repo.git('checkout', '-b', 'b2');
  const b2 = await commit(
    repo.dir,
    repo.git,
    'F.txt',
    lines([2, 'L2-from-b1'], [9, 'L9-from-b2']),
    'b2: rewrite L9',
  );
  stack = StackManager.addNode(stack, 'b2', 'b1');
  stack = StackManager.updateNode(stack, 'b2', { lastKnownHead: b2 });

  await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
  repo.git('checkout', 'b2');

  return { dir: repo.dir, configDir, git: repo.git };
}

describe('gitq absorb --at', () => {
  // The gap the flag exists for: a fix to b1's region is attributed to b2,
  // because attribution is file-level and b2 is the deepest branch touching it.
  test('without --at, a fix to the ancestor region lands on the deepest toucher', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-from-b2']), 'utf-8');

    const { stdout, exitCode } = await runCli(['absorb', '--preview', '--json'], dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).result.attributed).toEqual({ b2: ['F.txt'] });
  });

  test('--at puts the fix on the named branch and the descendant still replays', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-from-b2']), 'utf-8');
    const b1Before = sha(dir, 'b1');

    const { stdout, exitCode } = await runCli(['absorb', '--at', 'b1', '--json'], dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.absorbed).toBe(true);
    expect(parsed.result.attributions.map((a: { branch: string }) => a.branch)).toEqual(['b1']);

    expect(sha(dir, 'b1')).not.toBe(b1Before);
    // b1 carries the fix without inheriting b2's region.
    expect(fileAt(dir, 'b1', 'F.txt')).toBe(lines([2, 'L2-fixed']));
    // b2 replayed onto the amended b1: it keeps its own region and inherits the fix.
    expect(fileAt(dir, 'b2', 'F.txt')).toBe(lines([2, 'L2-fixed'], [9, 'L9-from-b2']));
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().trim()).toBe('');
  });

  test('an edit that will not replay onto the target is refused before anything moves', async () => {
    const { dir, configDir } = await makeRegionStack();
    // Dirty b2's OWN region, then force it onto b1. b1's copy of L9 and the
    // edit's both differ from the base, so the replay has no answer: this is
    // the case overriding attribution gives up the conflict-free guarantee for.
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-from-b1'], [9, 'L9-dirty']), 'utf-8');
    const b1Before = sha(dir, 'b1');
    const b2Before = sha(dir, 'b2');

    const { stdout, exitCode } = await runCli(['absorb', '--at', 'b1', '--json'], dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.absorbed).toBe(false);
    expect(parsed.result.unapplied).toEqual(['F.txt']);

    // Refused before the stash: no commits moved, no rebase started, and the
    // edit is still sitting in the worktree where the human left it.
    expect(sha(dir, 'b1')).toBe(b1Before);
    expect(sha(dir, 'b2')).toBe(b2Before);
    expect(existsSync(join(dir, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(dir, '.git', 'rebase-apply'))).toBe(false);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toContain('F.txt');
    expect(await Bun.file(join(dir, 'F.txt')).text()).toBe(lines([2, 'L2-from-b1'], [9, 'L9-dirty']));
  });

  test('the refusal names the file and the branch it would not replay onto', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-from-b1'], [9, 'L9-dirty']), 'utf-8');

    const { stdout } = await runCli(['absorb', '--at', 'b1'], dir, configDir);
    expect(stdout).toContain('F.txt');
    expect(stdout).toContain('does not replay');
  });

  test('--at a branch outside the stack refuses before touching anything', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-from-b2']), 'utf-8');

    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
    const b1Before = sha(dir, 'b1');

    const { exitCode, stderr } = await runCli(['absorb', '--at', 'nope'], dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('nope');
    expect(stderr).toContain('not in stack');
    expect(stderr).toContain('b1');

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toBe(statusBefore);
    expect(sha(dir, 'b1')).toBe(b1Before);
  });

  test('--preview --at previews against the named branch and commits nothing', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-from-b2']), 'utf-8');
    const b1Before = sha(dir, 'b1');

    const { stdout, exitCode } = await runCli(['absorb', '--preview', '--at', 'b1', '--json'], dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).result.attributed).toEqual({ b1: ['F.txt'] });
    expect(sha(dir, 'b1')).toBe(b1Before);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toContain('F.txt');
  });
});
