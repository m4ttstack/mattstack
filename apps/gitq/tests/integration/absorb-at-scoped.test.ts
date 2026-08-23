/**
 * `gitq absorb --at <branch>:<glob>`: override attribution for SOME files and
 * let the engine keep deciding the rest.
 *
 * The shape that motivated it, from a 19-branch stack: absorb attributed four
 * dirty files, three correctly, and put the fourth (a package `exports` entry)
 * on the branch that owns the manifest — where the file it exports does not
 * exist yet. A bare `--at` would have sent all four to one branch, so the only
 * way out was doing it by hand.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit, runCli } from './helpers.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore } from '../../src/core/persistence.ts';
import { StackManager } from '../../src/core/stack-manager.ts';

let dirsToClean: string[] = [];

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
});

const sha = (dir: string, rev: string): string =>
  execFileSync('git', ['rev-parse', rev], { cwd: dir }).toString().trim();

const fileAt = (dir: string, rev: string, path: string): string =>
  execFileSync('git', ['show', `${rev}:${path}`], { cwd: dir }).toString();

/**
 * Two branches, each owning its own files outright:
 *
 *   b1: pkg/manifest.txt
 *   b2: app/main.txt, app/other.txt
 *
 * Computed attribution sends each file to its owner. The tests below dirty
 * several at once and move only some of them.
 */
async function makeTwoBranchStack(): Promise<{ dir: string; configDir: string }> {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  setConfigDir(configDir);

  await mkdir(join(repo.dir, 'pkg'), { recursive: true });
  await mkdir(join(repo.dir, 'app'), { recursive: true });

  let stack = StackManager.createStack('scoped', 'main');

  repo.git('checkout', '-b', 'b1');
  const b1 = await commit(repo.dir, repo.git, 'pkg/manifest.txt', 'manifest v1\n', 'b1: manifest');
  stack = StackManager.addNode(stack, 'b1', 'main');
  stack = StackManager.updateNode(stack, 'b1', { lastKnownHead: b1 });

  repo.git('checkout', '-b', 'b2');
  await commit(repo.dir, repo.git, 'app/main.txt', 'main v1\n', 'b2: main');
  const b2 = await commit(repo.dir, repo.git, 'app/other.txt', 'other v1\n', 'b2: other');
  stack = StackManager.addNode(stack, 'b2', 'b1');
  stack = StackManager.updateNode(stack, 'b2', { lastKnownHead: b2 });

  await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
  repo.git('checkout', 'b2');
  return { dir: repo.dir, configDir };
}

/** Dirty one file owned by b1 and two owned by b2. */
async function dirtyAll(dir: string): Promise<void> {
  await writeFile(join(dir, 'pkg/manifest.txt'), 'manifest v2\n', 'utf-8');
  await writeFile(join(dir, 'app/main.txt'), 'main v2\n', 'utf-8');
  await writeFile(join(dir, 'app/other.txt'), 'other v2\n', 'utf-8');
}

describe('gitq absorb --at <branch>:<glob>', () => {
  test('a scoped override moves its match and leaves the rest to the engine', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    // manifest.txt is b1's by attribution; force it onto b2 instead, and let
    // the two app files attribute normally (which is also b2 here).
    const { stdout, exitCode } = await runCli(
      ['absorb', '--preview', '--at', 'b2:pkg/**', '--json'],
      dir,
      configDir,
    );

    expect(exitCode).toBe(0);
    const { attributed } = JSON.parse(stdout).result;
    expect(attributed.b2.sort()).toEqual(['app/main.txt', 'app/other.txt', 'pkg/manifest.txt']);
    expect(attributed.b1).toBeUndefined();
  });

  test('unmatched files keep their computed branch, not the override target', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    // Only the app files are forced onto b1. manifest.txt must still go to b1
    // by attribution -- and, crucially, the two app files must NOT stay on b2.
    const { stdout } = await runCli(
      ['absorb', '--preview', '--at', 'b1:app/**', '--json'],
      dir,
      configDir,
    );

    const { attributed } = JSON.parse(stdout).result;
    expect(attributed.b1.sort()).toEqual(['app/main.txt', 'app/other.txt', 'pkg/manifest.txt']);
    expect(attributed.b2).toBeUndefined();
  });

  test('a bare --at alongside scoped ones is the catch-all for what is left', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    const { stdout } = await runCli(
      ['absorb', '--preview', '--at', 'b1:pkg/**', '--at', 'b2', '--json'],
      dir,
      configDir,
    );

    const { attributed } = JSON.parse(stdout).result;
    expect(attributed.b1).toEqual(['pkg/manifest.txt']);
    expect(attributed.b2.sort()).toEqual(['app/main.txt', 'app/other.txt']);
  });

  test('scoped overrides actually commit where they were sent', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await writeFile(join(dir, 'pkg/manifest.txt'), 'manifest v2\n', 'utf-8');
    await writeFile(join(dir, 'app/main.txt'), 'main v2\n', 'utf-8');
    const b1Before = sha(dir, 'b1');

    const { exitCode } = await runCli(
      ['absorb', '--at', 'b2:pkg/**', '--json'],
      dir,
      configDir,
    );
    expect(exitCode).toBe(0);

    // b1 untouched: its file was forced away from it.
    expect(sha(dir, 'b1')).toBe(b1Before);
    expect(fileAt(dir, 'b1', 'pkg/manifest.txt')).toBe('manifest v1\n');
    // b2 carries both.
    expect(fileAt(dir, 'b2', 'pkg/manifest.txt')).toBe('manifest v2\n');
    expect(fileAt(dir, 'b2', 'app/main.txt')).toBe('main v2\n');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().trim()).toBe('');
  });

  test('two overrides claiming one file for different branches is refused', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);
    const b1Before = sha(dir, 'b1');
    const b2Before = sha(dir, 'b2');

    const { exitCode, stderr } = await runCli(
      ['absorb', '--at', 'b1:pkg/**', '--at', 'b2:**/manifest.txt', '--json'],
      dir,
      configDir,
    );

    // Silently picking one would put a fix on a branch the human did not
    // choose, which is the whole failure --at exists to prevent.
    expect(exitCode).toBe(1);
    expect(stderr).toContain('pkg/manifest.txt');
    expect(stderr).toContain('b1:pkg/**');
    expect(stderr).toContain('b2:**/manifest.txt');
    expect(sha(dir, 'b1')).toBe(b1Before);
    expect(sha(dir, 'b2')).toBe(b2Before);
  });

  test('two overlapping overrides naming the SAME branch are fine', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    // Overlap is only ambiguous when the answers differ.
    const { stdout, exitCode } = await runCli(
      ['absorb', '--preview', '--at', 'b2:pkg/**', '--at', 'b2:**/manifest.txt', '--json'],
      dir,
      configDir,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).result.attributed.b2).toContain('pkg/manifest.txt');
  });

  test('two bare --at targets are refused: there is only one catch-all', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    const { exitCode, stderr } = await runCli(
      ['absorb', '--at', 'b1', '--at', 'b2'],
      dir,
      configDir,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/one --at|catch-all/i);
  });

  test('a scoped --at naming a branch outside the stack is refused', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    const { exitCode, stderr } = await runCli(['absorb', '--at', 'nope:pkg/**'], dir, configDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('nope');
    expect(stderr).toContain('not in stack');
  });

  test('an --at with an empty glob is refused rather than read as a catch-all', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    const { exitCode, stderr } = await runCli(['absorb', '--at', 'b1:'], dir, configDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('b1:');
  });

  test('a scoped --at matching nothing is refused, not silently ignored', async () => {
    const { dir, configDir } = await makeTwoBranchStack();
    await dirtyAll(dir);

    // A typo'd glob that quietly matches nothing looks exactly like a working
    // override whose files went to the engine's choice instead.
    const { exitCode, stderr } = await runCli(
      ['absorb', '--preview', '--at', 'b1:does/not/exist/**'],
      dir,
      configDir,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain('does/not/exist/**');
  });
});
