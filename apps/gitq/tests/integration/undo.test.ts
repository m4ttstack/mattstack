import { describe, test, expect, afterEach } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { reparentBranch } from '../../src/core/reparent.ts';
import { OperationLog } from '../../src/core/operation-log.ts';
import { canUndo, undo } from '../../src/core/undo.ts';
import {
  createSandboxRepo,
  cleanupRepo,
  buildLinearStack,
  commit,
  type SandboxRepo,
} from './helpers.ts';

let repo: SandboxRepo;
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

describe('Undo cascade rebase', () => {
  test('restores branches to pre-rebase state after rebase', async () => {
    repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 3);

    // Record pre-rebase SHAs
    const branchSnapshots: Record<string, string> = {};
    for (const node of stack.nodes) {
      branchSnapshots[node.branch] = shas.get(node.branch)!;
    }

    const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots);

    // Advance main and manually rebase each branch using rebaseSingle
    repo.git('checkout', 'main');
    await commit(repo.dir, repo.git, 'main-advance.txt', 'new main content\n', 'advance main');
    const mainHead = repo.git('rev-parse', 'HEAD');

    // Rebase branch-1 onto new main (oldBase = original main SHA)
    const originalMainSha = shas.get('main')!;
    await RebaseEngine.rebaseSingle(repo.dir, mainHead, originalMainSha, 'feat/branch-1');
    const newBranch1Head = await GitShell.getBranchHead(repo.dir, 'feat/branch-1');

    // Rebase branch-2 onto new branch-1 (oldBase = original branch-1 SHA)
    await RebaseEngine.rebaseSingle(repo.dir, newBranch1Head, shas.get('feat/branch-1')!, 'feat/branch-2');
    const newBranch2Head = await GitShell.getBranchHead(repo.dir, 'feat/branch-2');

    // Rebase branch-3 onto new branch-2 (oldBase = original branch-2 SHA)
    await RebaseEngine.rebaseSingle(repo.dir, newBranch2Head, shas.get('feat/branch-2')!, 'feat/branch-3');

    // Verify branches moved
    for (const node of stack.nodes) {
      const newHead = await GitShell.getBranchHead(repo.dir, node.branch);
      expect(newHead).not.toBe(shas.get(node.branch));
    }

    // Undo
    const undoResult = await undo(repo.dir, entry);
    expect(undoResult.success).toBe(true);
    expect(undoResult.restoredBranches).toHaveLength(3);

    // Verify branches are back to pre-rebase SHAs
    for (const node of stack.nodes) {
      const head = await GitShell.getBranchHead(repo.dir, node.branch);
      expect(head).toBe(shas.get(node.branch)!);
    }

    // Verify file contents on each branch match pre-rebase state
    for (let i = 1; i <= 3; i++) {
      const branch = `feat/branch-${i}`;
      repo.git('checkout', branch);
      const contentA = await readFile(join(repo.dir, `file-${i}-a.txt`), 'utf-8');
      expect(contentA).toBe(`branch ${i} commit A\n`);
    }

    // Verify stack tree is restored
    expect(undoResult.restoredStack).toEqual(stack);

    // Working tree should be clean
    const dirty = await GitShell.isDirty(repo.dir);
    expect(dirty).toBe(false);
  });
});

describe('Undo reparent', () => {
  test('restores branch to original parent after reparent', async () => {
    repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 3);

    // Snapshot before reparent
    const branchSnapshots: Record<string, string> = {};
    for (const node of stack.nodes) {
      branchSnapshots[node.branch] = shas.get(node.branch)!;
    }
    const entry = OperationLog.create('reparent', stack, branchSnapshots);

    // Reparent branch-3 from branch-2 to main
    const reparentResult = await reparentBranch(repo.dir, stack, 'feat/branch-3', 'main');
    expect(reparentResult.newParent).toBe('main');

    // branch-3 HEAD should have changed
    const afterHead = await GitShell.getBranchHead(repo.dir, 'feat/branch-3');
    expect(afterHead).not.toBe(branchSnapshots['feat/branch-3']);

    // Undo
    const undoResult = await undo(repo.dir, entry);
    expect(undoResult.success).toBe(true);

    // Branch-3 HEAD restored
    const restoredHead = await GitShell.getBranchHead(repo.dir, 'feat/branch-3');
    expect(restoredHead).toBe(branchSnapshots['feat/branch-3']);

    // Stack tree restored (branch-3 is child of branch-2 again)
    const branch3Node = undoResult.restoredStack.nodes.find((n) => n.branch === 'feat/branch-3');
    expect(branch3Node?.parent).toBe('feat/branch-2');
  });
});

describe('Operation log captures commands', () => {
  test('records command details during rebase', async () => {
    repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 2);

    repo.git('checkout', 'main');
    await commit(repo.dir, repo.git, 'main-new.txt', 'advance\n', 'advance main');
    const mainHead = repo.git('rev-parse', 'HEAD');

    const branchSnapshots: Record<string, string> = {};
    for (const node of stack.nodes) {
      branchSnapshots[node.branch] = shas.get(node.branch)!;
    }

    const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots);

    // Record commands via commandHook
    const hook = OperationLog.commandHook(entry);

    const start1 = performance.now();
    await RebaseEngine.rebaseSingle(repo.dir, mainHead, shas.get('main')!, 'feat/branch-1');
    hook('git', ['rebase', '--onto', mainHead, shas.get('main')!, 'feat/branch-1'], repo.dir, 0, Math.ceil(performance.now() - start1));

    const newBranch1Head = await GitShell.getBranchHead(repo.dir, 'feat/branch-1');
    const start2 = performance.now();
    await RebaseEngine.rebaseSingle(repo.dir, newBranch1Head, shas.get('feat/branch-1')!, 'feat/branch-2');
    hook('git', ['rebase', '--onto', newBranch1Head, shas.get('feat/branch-1')!, 'feat/branch-2'], repo.dir, 0, Math.ceil(performance.now() - start2));

    expect(entry.commands).toHaveLength(2);
    expect(entry.commands[0]!.exitCode).toBe(0);
    expect(entry.commands[0]!.duration).toBeGreaterThanOrEqual(0);
    expect(entry.commands[0]!.args[0]).toBe('rebase');
    expect(entry.branchSnapshots).toEqual(branchSnapshots);
    expect(entry.stackSnapshot).toEqual(stack);
  });
});

describe('Log FIFO cap (integration)', () => {
  test('canUndo correctly distinguishes reversible vs non-reversible', async () => {
    repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack } = await buildLinearStack(repo.dir, repo.git, 1);

    const rebaseEntry = OperationLog.create('cascade-rebase', stack, { main: 'sha-1' });
    const foldEntry = OperationLog.create('fold', stack, { main: 'sha-2' });
    const absorbEntry = OperationLog.create('absorb', stack, { main: 'sha-3' });
    const splitEntry = OperationLog.create('split', stack, { main: 'sha-4' });

    expect(canUndo(rebaseEntry)).toBe(true);
    expect(canUndo(foldEntry)).toBe(false);
    expect(canUndo(absorbEntry)).toBe(true);
    expect(canUndo(splitEntry)).toBe(false);
  });
});

describe('Undo on empty state', () => {
  test('returns clean error when no snapshots', async () => {
    repo = await createSandboxRepo();
    dirs.push(repo.dir);

    const { stack } = await buildLinearStack(repo.dir, repo.git, 1);

    const entry = OperationLog.create('cascade-rebase', stack, {});
    const result = await undo(repo.dir, entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No branch snapshots');
    expect(result.restoredStack).toEqual(stack);
  });
});
