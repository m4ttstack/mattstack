import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, rm, chmod, lstat, symlink, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { GitShell } from '../../src/core/git-shell.ts';
import type { Stack } from '../../src/core/types.ts';

let sandbox: SandboxRepo;

afterEach(async () => {
  if (sandbox) await cleanupRepo(sandbox.dir);
});

async function buildAbsorbStack(
  sb: SandboxRepo,
): Promise<{ stack: Stack; shas: Map<string, string> }> {
  const { dir, git } = sb;
  const shas = new Map<string, string>();
  let stack = StackManager.createStack('absorb-test', 'main');

  shas.set('main', git('rev-parse', 'HEAD'));

  git('checkout', '-b', 'branch-1');
  const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'branch-1: add api.ts');
  shas.set('branch-1', sha1);
  stack = StackManager.addNode(stack, 'branch-1', 'main');
  stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });

  git('checkout', '-b', 'branch-2');
  const sha2 = await commit(dir, git, 'config.json', '{ "key": "value" }\n', 'branch-2: add config.json');
  shas.set('branch-2', sha2);
  stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
  stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

  git('checkout', '-b', 'branch-3');
  const sha3 = await commit(dir, git, 'ui.tsx', 'export function UI() {}\n', 'branch-3: add ui.tsx');
  shas.set('branch-3', sha3);
  stack = StackManager.addNode(stack, 'branch-3', 'branch-2');
  stack = StackManager.updateNode(stack, 'branch-3', { lastKnownHead: sha3 });

  return { stack, shas };
}

describe('Absorb integration', () => {
  test('multi-branch attribution: changes go to the correct branches', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    await writeFile(join(dir, 'config.json'), '{ "key": "updated" }\n');
    await writeFile(join(dir, 'ui.tsx'), 'export function UI() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    expect(result.attributions.length).toBeGreaterThanOrEqual(2);
    expect(result.attributions.every((a) => a.success)).toBe(true);

    git('checkout', 'branch-1');
    const apiContent = await readFile(join(dir, 'api.ts'), 'utf-8');
    expect(apiContent).toContain('updated');

    git('checkout', 'branch-2');
    const configContent = await readFile(join(dir, 'config.json'), 'utf-8');
    expect(configContent).toContain('updated');

    git('checkout', 'branch-3');
    const uiContent = await readFile(join(dir, 'ui.tsx'), 'utf-8');
    expect(uiContent).toContain('updated');

    for (const branch of ['branch-1', 'branch-2', 'branch-3']) {
      const node = StackManager.findNode(result.updatedStack!, branch);
      if (node) {
        const needsRebase = await RebaseEngine.needsRebase(dir, result.updatedStack!, branch);
        expect(needsRebase).toBe(false);
      }
    }

    const dirty = await GitShell.isDirty(dir);
    expect(dirty).toBe(false);
  });

  test('unattributed file stays uncommitted in the worktree', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');
    const headBefore = git('rev-parse', 'HEAD');

    await writeFile(join(dir, 'notes.txt'), 'some notes\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(false);
    expect(result.reason).toBe('nothing-attributable');
    expect(result.unattributed).toEqual(['notes.txt']);
    expect(result.attributions).toEqual([]);

    // No branch was rewritten to hold it, and it is still sitting there.
    expect(git('rev-parse', 'HEAD')).toBe(headBefore);
    expect(git('status', '--short')).toBe('?? notes.txt');
    expect(await readFile(join(dir, 'notes.txt'), 'utf-8')).toBe('some notes\n');
    expect(git('log', '--all', '--oneline', '--name-only')).not.toContain('notes.txt');
  });

  test('unattributed file survives alongside files that are absorbed', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    await writeFile(join(dir, 'notes.txt'), 'some notes\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['notes.txt']);
    expect(result.attributions.map((a) => a.branch)).toEqual(['branch-1']);
    expect(result.attributions[0]!.files).toEqual(['api.ts']);

    // api.ts landed on branch-1 and the descendants were restacked...
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('branch-3');
    git('checkout', 'branch-1');
    expect(await readFile(join(dir, 'api.ts'), 'utf-8')).toContain('updated');
    git('checkout', 'branch-3');

    // ...while notes.txt is still untracked in the worktree.
    expect(git('status', '--short')).toBe('?? notes.txt');
    expect(await readFile(join(dir, 'notes.txt'), 'utf-8')).toBe('some notes\n');
  });

  test('unattributed edit to a tracked file comes back as a worktree change', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    // README.md came from main; no stack branch's commits touched it.
    await writeFile(join(dir, 'README.md'), '# Test Repo edited\n');
    await writeFile(join(dir, 'ui.tsx'), 'export function UI() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['README.md']);
    expect(git('status', '--short')).toBe('M README.md');
    expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe('# Test Repo edited\n');
    expect(git('show', 'branch-3:README.md')).toBe('# Test Repo');
  });

  test('an unattributed file does not rewrite the stack root', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'main');
    const mainBefore = git('rev-parse', 'main');

    await writeFile(join(dir, 'newfile.md'), '# New File\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(false);
    expect(result.unattributed).toEqual(['newfile.md']);
    expect(git('rev-parse', 'main')).toBe(mainBefore);
    expect(git('status', '--short')).toBe('?? newfile.md');
  });

  // ── Paths git quotes ───────────────────────────────────────────────────────
  //
  // `git status`/`diff`/`ls-files` C-quote any path they consider unusual, so
  // `café.txt` comes back as `"caf\303\251.txt"`. Hand that string to the
  // filesystem and you address a file that does not exist — which, for a file
  // absorb is about to stash and then restore from a snapshot, is the
  // difference between a round trip and a deletion with no copy left.

  test('an unattributed file whose path git quotes survives the round trip', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    await writeFile(join(dir, 'café.txt'), 'unicode notes\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['café.txt']);
    expect(result.attributions.map((a) => a.branch)).toEqual(['branch-1']);

    // Still there, byte-identical, still untracked — and not in any commit.
    expect(await readFile(join(dir, 'café.txt'), 'utf-8')).toBe('unicode notes\n');
    expect(git('status', '--short')).toBe('?? "caf\\303\\251.txt"');
    expect(git('log', '--all', '--oneline', '--name-only')).not.toContain('caf');
  });

  test('an unattributed file with quotes and spaces in its name survives', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    const awkward = 'a "quoted" name.txt';
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    await writeFile(join(dir, awkward), 'awkward\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual([awkward]);
    expect(await readFile(join(dir, awkward), 'utf-8')).toBe('awkward\n');
  });

  test('a non-ASCII path a branch owns is attributed to that branch, not left over', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;

    // Attribution compares the changed-file listing against each branch's own
    // diff. Both sides have to spell the path the same way or a file a branch
    // plainly owns silently comes back unattributed.
    let stack = StackManager.createStack('unicode-test', 'main');
    git('checkout', '-b', 'uni-1');
    const sha1 = await commit(dir, git, 'café.ts', 'export const cafe = 1;\n', 'uni-1: add café.ts');
    stack = StackManager.addNode(stack, 'uni-1', 'main');
    stack = StackManager.updateNode(stack, 'uni-1', { lastKnownHead: sha1 });

    git('checkout', '-b', 'uni-2');
    const sha2 = await commit(dir, git, 'other.ts', 'export const other = 1;\n', 'uni-2: add other.ts');
    stack = StackManager.addNode(stack, 'uni-2', 'uni-1');
    stack = StackManager.updateNode(stack, 'uni-2', { lastKnownHead: sha2 });

    await writeFile(join(dir, 'café.ts'), 'export const cafe = 2;\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual([]);
    expect(result.attributions[0]!.branch).toBe('uni-1');
    expect(result.attributions[0]!.files).toEqual(['café.ts']);
    expect(git('show', 'uni-1:café.ts')).toContain('cafe = 2');
  });

  test('a genuinely deleted unattributed file stays deleted', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    // README.md came from main, so no stack branch's commits own it.
    await rm(join(dir, 'README.md'));
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    expect(result.unattributed).toEqual(['README.md']);
    expect(existsSync(join(dir, 'README.md'))).toBe(false);
    // The helper trims, so this is the ` D README.md` of a worktree deletion.
    expect(git('status', '--short')).toBe('D README.md');
    // The deletion is still just a worktree state, not a commit.
    expect(git('show', 'branch-3:README.md')).toBe('# Test Repo');
  });

  // ── Entry fidelity ─────────────────────────────────────────────────────────
  //
  // What absorb takes away and gives back is a worktree ENTRY, not a byte
  // string. Replaying only the bytes turns a 755 script into a 644 one, a
  // symlink into a regular file, and a partially staged file into a fully
  // staged one — all of them silent, and all of them "your file is still
  // there" as far as a content check can tell.

  test('an untracked executable comes back executable', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    await writeFile(join(dir, 'deploy.sh'), '#!/bin/sh\necho deploy\n');
    await chmod(join(dir, 'deploy.sh'), 0o755);

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual(['deploy.sh']);
    expect((await lstat(join(dir, 'deploy.sh'))).mode & 0o777).toBe(0o755);
    expect(git('status', '--short')).toBe('?? deploy.sh');
  });

  test('a chmod-only edit to a tracked file is not reverted', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    // README.md is unattributed (it came from main) and its only change is
    // the mode, which a content-only restore cannot see at all.
    await chmod(join(dir, 'README.md'), 0o755);
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual(['README.md']);
    expect((await lstat(join(dir, 'README.md'))).mode & 0o777).toBe(0o755);
    expect(git('status', '--short')).toBe('M README.md');
  });

  test('an untracked symlink comes back a symlink, dangling target and all', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');
    await symlink('api.ts', join(dir, 'link.ts'));
    await symlink('nowhere.txt', join(dir, 'dangling.txt'));

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed.sort()).toEqual(['dangling.txt', 'link.ts']);
    expect((await lstat(join(dir, 'link.ts'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(dir, 'link.ts'))).toBe('api.ts');
    // The dangling one is the case a "read the file" snapshot cannot take at
    // all: nothing to read, and nothing missing either.
    expect((await lstat(join(dir, 'dangling.txt'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(dir, 'dangling.txt'))).toBe('nowhere.txt');
  });

  test('a partially staged file keeps its staged/unstaged split', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    // README.md: one version in the index, a further edit in the worktree —
    // what `git add -p` leaves behind, reported as `MM`.
    await writeFile(join(dir, 'README.md'), '# Test Repo staged\n');
    git('add', 'README.md');
    await writeFile(join(dir, 'README.md'), '# Test Repo staged then edited\n');
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual(['README.md']);
    expect(git('status', '--short')).toBe('MM README.md');
    expect(git('show', ':README.md')).toBe('# Test Repo staged');
    expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe('# Test Repo staged then edited\n');
  });

  test('a staged new file comes back staged', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'notes.txt'), 'staged notes\n');
    git('add', 'notes.txt');
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual(['notes.txt']);
    expect(git('status', '--short')).toBe('A  notes.txt');
    expect(await readFile(join(dir, 'notes.txt'), 'utf-8')).toBe('staged notes\n');
  });

  test('a staged deletion comes back staged as a deletion', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    git('rm', '--quiet', 'README.md');
    await writeFile(join(dir, 'api.ts'), 'export function api() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.unattributed).toEqual(['README.md']);
    expect(existsSync(join(dir, 'README.md'))).toBe(false);
    expect(git('status', '--short')).toBe('D  README.md');
  });

  test('fan-out attribution: sibling branches get correct files', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    let stack = StackManager.createStack('fan-test', 'main');

    git('checkout', '-b', 'feat/a');
    const shaA = await commit(dir, git, 'a.ts', 'a code\n', 'feat/a: add a.ts');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: shaA });

    git('checkout', '-b', 'feat/b');
    const shaB = await commit(dir, git, 'b.txt', 'b content\n', 'feat/b: add b.txt');
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: shaB });

    git('checkout', 'feat/a');
    git('checkout', '-b', 'feat/c');
    const shaC = await commit(dir, git, 'c.txt', 'c content\n', 'feat/c: add c.txt');
    stack = StackManager.addNode(stack, 'feat/c', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/c', { lastKnownHead: shaC });

    git('checkout', 'feat/b');

    await writeFile(join(dir, 'b.txt'), 'b updated\n');
    await writeFile(join(dir, 'c.txt'), 'c updated\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);
    const bAttr = result.attributions.find((a) => a.branch === 'feat/b');
    const cAttr = result.attributions.find((a) => a.branch === 'feat/c');
    expect(bAttr?.files).toContain('b.txt');
    expect(cAttr?.files).toContain('c.txt');

    git('checkout', 'feat/b');
    const bContent = await readFile(join(dir, 'b.txt'), 'utf-8');
    expect(bContent).toBe('b updated\n');

    git('checkout', 'feat/c');
    const cContent = await readFile(join(dir, 'c.txt'), 'utf-8');
    expect(cContent).toBe('c updated\n');
  });

  test('clean working tree returns no-changes', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(false);
    expect(result.reason).toBe('no-changes');
    expect(result.attributions).toEqual([]);
  });

  test('post-absorb content integrity: pre-existing file contents survive', async () => {
    sandbox = await createSandboxRepo();
    const { dir, git } = sandbox;
    const { stack } = await buildAbsorbStack(sandbox);

    git('checkout', 'branch-3');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "v2"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);
    expect(result.absorbed).toBe(true);

    git('checkout', 'branch-1');
    const api = await readFile(join(dir, 'api.ts'), 'utf-8');
    expect(api).toContain('v2');
    expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe('# Test Repo\n');

    git('checkout', 'branch-2');
    const config = await readFile(join(dir, 'config.json'), 'utf-8');
    expect(config).toBe('{ "key": "value" }\n');

    git('checkout', 'branch-3');
    const ui = await readFile(join(dir, 'ui.tsx'), 'utf-8');
    expect(ui).toBe('export function UI() {}\n');
  });
});
