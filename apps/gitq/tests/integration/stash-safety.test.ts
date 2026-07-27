import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
import { createSandboxRepo, cleanupRepo, commit, buildLinearStack } from './helpers.ts';
import type { SandboxRepo } from './helpers.ts';

let sandbox: SandboxRepo;
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Absorb stash safety ──────────────────────────────────────────────────────

describe('Absorb stash safety', () => {
  test('uncommitted changes survive absorb — no data loss', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'add api.ts');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'config.json', '{"key":"value"}\n', 'add config.json');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    git('checkout', 'branch-2');

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "modified"; }\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(true);

    git('checkout', 'branch-1');
    const apiContent = await readFile(join(dir, 'api.ts'), 'utf-8');
    expect(apiContent).toContain('modified');

    const dirty = await GitShell.isDirty(dir);
    expect(dirty).toBe(false);

    // Verify stash is empty (absorb should drop it on success)
    try {
      git('stash', 'show');
      throw new Error('stash should be empty');
    } catch (e: any) {
      expect(e.message || e.toString()).not.toContain('stash should be empty');
    }
  });

  test('an amend that fails mid-run pops the stash: every dirty file comes back', async () => {
    // The realistic way into absorb's abort path: a `pre-commit` hook that
    // refuses the SECOND branch's amend. The launch worktree's hooks stay
    // live (a leased work slot's would not), so the first amend lands and the
    // second throws, and everything the stash is holding has to come back.
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'add api.ts');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'config.json', '{"key":"value"}\n', 'add config.json');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    await writeFile(
      join(dir, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\ngit diff --cached --name-only | grep -q config.json && exit 1\nexit 0\n',
    );
    await chmod(join(dir, '.git', 'hooks', 'pre-commit'), 0o755);

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "user work"; }\n');
    await writeFile(join(dir, 'config.json'), '{"key":"user work"}\n');
    await writeFile(join(dir, 'notes.txt'), 'unowned notes\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(false);
    const failure = result.attributions.find((a) => !a.success);
    expect(failure?.branch).toBe('branch-2');
    // The unwind came back clean, so there is nothing to hand the human.
    expect(result.recovery).toBeUndefined();

    // Back where we started, with the whole dirty tree restored — including
    // the file the first (successful) amend had already committed elsewhere.
    expect(await GitShell.getCurrentBranch(dir)).toBe('branch-2');
    expect(await readFile(join(dir, 'api.ts'), 'utf-8')).toContain('user work');
    expect(await readFile(join(dir, 'config.json'), 'utf-8')).toBe('{"key":"user work"}\n');
    expect(await readFile(join(dir, 'notes.txt'), 'utf-8')).toBe('unowned notes\n');
    expect(git('stash', 'list')).toBe('');

    // Documented non-atomicity: branch-1's amend is not rolled back.
    expect(git('show', 'branch-1:api.ts')).toContain('user work');
  });

  test('an unwind that cannot get back names the branch and keeps the stash', async () => {
    // The other half of the abort path, and the reason a swallowed failure
    // here is not survivable: standing on the ANCESTOR, the amend that the
    // hook refuses leaves config.json staged, and config.json does not exist
    // on branch-1 at all — so the checkout back refuses too. Pre-fix, both
    // throws were discarded and the run ended quietly on the wrong branch
    // with the whole dirty tree in an unmentioned stash entry.
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'export function api() {}\n', 'add api.ts');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'config.json', '{"key":"value"}\n', 'add config.json');
    git('checkout', 'branch-1');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    await writeFile(
      join(dir, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\ngit diff --cached --name-only | grep -q config.json && exit 1\nexit 0\n',
    );
    await chmod(join(dir, '.git', 'hooks', 'pre-commit'), 0o755);

    await writeFile(join(dir, 'api.ts'), 'export function api() { return "user work"; }\n');
    await writeFile(join(dir, 'config.json'), '{"key":"user work"}\n');
    await writeFile(join(dir, 'notes.txt'), 'unowned notes\n');

    const result = await AbsorbEngine.absorb(dir, stack);

    expect(result.absorbed).toBe(false);
    // Says where you are, where you wanted to be, and where the work is.
    expect(result.recovery).toContain('branch-1');
    expect(result.recovery).toContain('you are on branch-2');
    expect(result.recovery).toContain('stash@{0}');
    expect(await GitShell.getCurrentBranch(dir)).toBe('branch-2');
    expect(git('stash', 'list')).toContain('stash@{0}');

    // And the recovery it prints actually recovers: the stash still holds
    // every dirty file, the unattributed one included.
    git('checkout', '-f', 'branch-1');
    git('stash', 'pop');
    expect(await readFile(join(dir, 'api.ts'), 'utf-8')).toContain('user work');
    expect(await readFile(join(dir, 'config.json'), 'utf-8')).toBe('{"key":"user work"}\n');
    expect(await readFile(join(dir, 'notes.txt'), 'utf-8')).toBe('unowned notes\n');
  });

  test('multiple uncommitted files across branches — all content preserved', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'a.ts', 'a\n', 'add a');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'b.ts', 'b\n', 'add b');
    git('checkout', '-b', 'branch-3');
    const sha3 = await commit(dir, git, 'c.ts', 'c\n', 'add c');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });
    stack = StackManager.addNode(stack, 'branch-3', 'branch-2');
    stack = StackManager.updateNode(stack, 'branch-3', { lastKnownHead: sha3 });

    git('checkout', 'branch-3');

    // Modify all three files
    await writeFile(join(dir, 'a.ts'), 'a-updated\n');
    await writeFile(join(dir, 'b.ts'), 'b-updated\n');
    await writeFile(join(dir, 'c.ts'), 'c-updated\n');

    const result = await AbsorbEngine.absorb(dir, stack);
    expect(result.absorbed).toBe(true);
    expect(result.attributions.every((a) => a.success)).toBe(true);

    // Verify each file landed on the correct branch
    git('checkout', 'branch-1');
    expect(await readFile(join(dir, 'a.ts'), 'utf-8')).toBe('a-updated\n');

    git('checkout', 'branch-2');
    expect(await readFile(join(dir, 'b.ts'), 'utf-8')).toBe('b-updated\n');

    git('checkout', 'branch-3');
    expect(await readFile(join(dir, 'c.ts'), 'utf-8')).toBe('c-updated\n');

    // Clean tree after absorb
    expect(await GitShell.isDirty(dir)).toBe(false);
  });
});

// ── Dirty tree guards ────────────────────────────────────────────────────────

describe('Dirty tree rejection guards', () => {
  test('cascade rebase preflight rejects dirty tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    await commit(dir, git, 'a.txt', 'a\n', 'add a');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');

    await writeFile(join(dir, 'dirty.txt'), 'dirty\n');

    const report = await RebaseEngine.preflight(dir, stack, ['feat/a']);
    expect(report.dirty).toBe(true);
  });

  test('reparent rejects dirty working tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/a');
    const aHead = await commit(dir, git, 'a.txt', 'a\n', 'add a');
    git('checkout', '-b', 'feat/b');
    const bHead = await commit(dir, git, 'b.txt', 'b\n', 'add b');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: aHead });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: bHead });

    await writeFile(join(dir, 'a.txt'), 'dirty\n');

    await expect(reparentBranch(dir, stack, 'feat/b', 'main')).rejects.toThrow(/uncommitted/);
  });

  test('split survives a dirty tree on another branch: no data loss, ref-only surgery', async () => {
    // tailSplit is ref-only surgery now: it never reads or writes the
    // working tree. Here `dir` is dirty but sits on `main`, not on the
    // split source (`feat/big`), so no worktree owns the source branch and
    // the split proceeds. The data-loss guarantee this file exists to prove
    // still holds: the dirty file must survive byte-identical and the
    // checkout must not move.
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/big');
    const sha1 = await commit(dir, git, 'f1.txt', '1\n', 'c1');
    const sha2 = await commit(dir, git, 'f2.txt', '2\n', 'c2');
    git('checkout', 'main');
    const launchHead = git('rev-parse', 'HEAD');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/big', 'main');
    stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: sha2 });

    await writeFile(join(dir, 'f1.txt'), 'dirty\n');

    const result = await BranchSplitter.tailSplit(dir, stack, 'feat/big', 'feat/tail', sha1);

    // Ref surgery landed correctly.
    expect(git('rev-parse', 'feat/big')).toBe(sha1);
    expect(git('rev-parse', 'feat/tail')).toBe(sha2);
    expect(result.movedCommits).toEqual([sha2]);

    // No data loss: the dirty file and the launch checkout are untouched.
    expect(await readFile(join(dir, 'f1.txt'), 'utf-8')).toBe('dirty\n');
    expect(git('rev-parse', 'HEAD')).toBe(launchHead);
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  test('split refuses when the dirty tree IS the checked-out source branch: nothing moved, nothing lost', async () => {
    // Same file, the other half of the contract: when the source branch's
    // OWN checkout is dirty, finalizeBranchRef's slot policy still refuses
    // (ref-only surgery does not bypass the dirty-checkout guard, it just
    // relocates it from a blanket cwd check to the slot that actually owns
    // the branch). Assert refusal, unmoved refs, no rollback leak (new
    // branch never created), and the dirty file untouched.
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/big');
    const sha1 = await commit(dir, git, 'f1.txt', '1\n', 'c1');
    const sha2 = await commit(dir, git, 'f2.txt', '2\n', 'c2');
    // stay checked out on feat/big: the split source itself is dirty here

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/big', 'main');
    stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: sha2 });

    await writeFile(join(dir, 'f1.txt'), 'dirty\n');

    await expect(
      BranchSplitter.tailSplit(dir, stack, 'feat/big', 'feat/tail', sha1),
    ).rejects.toThrow(/dirty|checked out/i);

    // Nothing moved, nothing lost.
    expect(git('rev-parse', 'feat/big')).toBe(sha2);
    expect(() => git('rev-parse', '--verify', 'refs/heads/feat/tail')).toThrow();
    expect(await readFile(join(dir, 'f1.txt'), 'utf-8')).toBe('dirty\n');
  });

  test('fold rejects dirty working tree', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const bHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');
    git('checkout', '-b', 'feat/child');
    const cHead = await commit(dir, git, 'child.txt', 'child\n', 'add child');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: bHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: cHead });

    await writeFile(join(dir, 'dirty.txt'), 'dirty\n');

    await expect(foldBranch(dir, stack, 'feat/child')).rejects.toThrow(/uncommitted/);
  });
});

// ── Post-operation branch restore ────────────────────────────────────────────

describe('Post-operation branch restore', () => {
  test('absorb returns to original branch after distributing changes', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'branch-1');
    const sha1 = await commit(dir, git, 'api.ts', 'api\n', 'add api');
    git('checkout', '-b', 'branch-2');
    const sha2 = await commit(dir, git, 'util.ts', 'util\n', 'add util');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    // Start on branch-2
    git('checkout', 'branch-2');
    await writeFile(join(dir, 'api.ts'), 'api-updated\n');

    await AbsorbEngine.absorb(dir, stack);

    // Should return to branch-2
    const current = await GitShell.getCurrentBranch(dir);
    expect(current).toBe('branch-2');
  });

  test('fold restores to main after deleting a branch', async () => {
    sandbox = await createSandboxRepo();
    dirs.push(sandbox.dir);
    const { dir, git } = sandbox;

    git('checkout', '-b', 'feat/base');
    const bHead = await commit(dir, git, 'base.txt', 'base\n', 'add base');
    git('checkout', '-b', 'feat/child');
    const cHead = await commit(dir, git, 'child.txt', 'child\n', 'add child');
    git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: bHead });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: cHead });

    await foldBranch(dir, stack, 'feat/child');

    // Branch should be deleted and we shouldn't be on it
    const current = await GitShell.getCurrentBranch(dir);
    expect(current).not.toBe('feat/child');
  });
});
