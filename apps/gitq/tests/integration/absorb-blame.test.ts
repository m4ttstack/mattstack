import { afterEach, describe, expect, test } from 'bun:test';
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

const lines = (...replacements: [number, string][]): string => {
  const out = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
  for (const [index, value] of replacements) out[index - 1] = value;
  return `${out.join('\n')}\n`;
};

/**
 * One file, three owners: `main` wrote L1..L10, `b1` rewrote L2, `b2` rewrote
 * L9. Every branch in the stack has touched F.txt, so file-level attribution
 * can only ever answer "b2" for anything dirty in it.
 *
 * Leaves the worktree on b2.
 */
async function makeRegionStack(): Promise<{ dir: string; configDir: string }> {
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

  return { dir: repo.dir, configDir };
}

/** The attribution absorb would use, without committing anything. */
async function attributionOf(dir: string, configDir: string): Promise<Record<string, string[]>> {
  const { stdout, exitCode } = await runCli(['absorb', '--preview', '--json'], dir, configDir);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout).result.attributed;
}

describe('absorb attribution by blame', () => {
  // The MAT-82 case: the edit changes lines b1 introduced, in a file b2 also
  // touched. File-level attribution answers b2, which would fix b2's pipeline
  // and leave b1's failing on the very line being fixed here.
  test('an edit to the ancestor lines is attributed to the ancestor', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-from-b2']), 'utf-8');

    expect(await attributionOf(dir, configDir)).toEqual({ b1: ['F.txt'] });
  });

  test('an edit to the descendant lines is still attributed to the descendant', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-from-b1'], [9, 'L9-fixed']), 'utf-8');

    expect(await attributionOf(dir, configDir)).toEqual({ b2: ['F.txt'] });
  });

  // A file goes to exactly one branch, so an edit spanning two owners has to
  // pick one. The deepest is the only choice that always replays.
  test('an edit spanning both owners goes to the deeper of them', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-fixed']), 'utf-8');

    expect(await attributionOf(dir, configDir)).toEqual({ b2: ['F.txt'] });
  });

  // Blame answers "main", which owns no node in the stack. There is nothing to
  // refine with, so this falls back to file-level deepest-toucher.
  test('an edit to lines from outside the stack falls back to file attribution', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(
      join(dir, 'F.txt'),
      lines([2, 'L2-from-b1'], [5, 'L5-fixed'], [9, 'L9-from-b2']),
      'utf-8',
    );

    expect(await attributionOf(dir, configDir)).toEqual({ b2: ['F.txt'] });
  });

  test('a brand new file has no blame basis and stays unattributed', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'new.txt'), 'brand new\n', 'utf-8');

    const { stdout } = await runCli(['absorb', '--preview', '--json'], dir, configDir);
    const result = JSON.parse(stdout).result;
    expect(result.attributed).toEqual({});
    expect(result.unattributed).toEqual(['new.txt']);
  });

  // Attribution decides where it goes; the replay from phase 1 decides what
  // lands there. Together they put the fix on b1 without dragging b2 down.
  test('the ancestor gets only the fix, and the descendant still replays', async () => {
    const { dir, configDir } = await makeRegionStack();
    await writeFile(join(dir, 'F.txt'), lines([2, 'L2-fixed'], [9, 'L9-from-b2']), 'utf-8');

    const { stdout, exitCode } = await runCli(['absorb', '--json'], dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).result.attributions.map((a: { branch: string }) => a.branch)).toEqual(['b1']);

    const show = (rev: string) =>
      Bun.spawnSync(['git', 'show', `${rev}:F.txt`], { cwd: dir }).stdout.toString();
    expect(show('b1')).toBe(lines([2, 'L2-fixed']));
    expect(show('b2')).toBe(lines([2, 'L2-fixed'], [9, 'L9-from-b2']));
  });
});
