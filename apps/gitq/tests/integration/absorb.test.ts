import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile } from 'node:fs/promises';
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
