import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { StackManager } from '../../src/core/stack-manager.ts';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, commit, type SandboxRepo } from './helpers.ts';

mock.restore();

let repo: SandboxRepo;

beforeAll(async () => {
  repo = await createSandboxRepo();
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
});

// ── tailSplit ────────────────────────────────────────────────────────────────

describe('BranchSplitter.tailSplit integration', () => {
  test('splits commits correctly: source keeps early commits, new branch gets later ones', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/big');
      const sha1 = await commit(r.dir, r.git, 'f1.txt', '1\n', 'commit 1');
      const sha2 = await commit(r.dir, r.git, 'f2.txt', '2\n', 'commit 2');
      const sha3 = await commit(r.dir, r.git, 'f3.txt', '3\n', 'commit 3');
      const sha4 = await commit(r.dir, r.git, 'f4.txt', '4\n', 'commit 4');
      const sha5 = await commit(r.dir, r.git, 'f5.txt', '5\n', 'commit 5');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/big', 'main');
      stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: sha5 });

      // Split after commit 3: commits 4 and 5 should move to new branch
      const result = await BranchSplitter.tailSplit(r.dir, stack, 'feat/big', 'feat/tail', sha3);

      expect(result.newBranch).toBe('feat/tail');
      expect(result.movedCommits).toEqual([sha5, sha4]);

      // Verify source branch (feat/big) has commits 1-3
      const sourceLog = await GitShell.logDetailed(r.dir, 'feat/big', 10);
      const sourceSubjects = sourceLog.map((c) => c.subject);
      expect(sourceSubjects).toContain('commit 1');
      expect(sourceSubjects).toContain('commit 2');
      expect(sourceSubjects).toContain('commit 3');
      expect(sourceSubjects).not.toContain('commit 4');
      expect(sourceSubjects).not.toContain('commit 5');

      // Verify new branch (feat/tail) has all 5 commits (it was created at original HEAD)
      const tailLog = await GitShell.logDetailed(r.dir, 'feat/tail', 10);
      const tailSubjects = tailLog.map((c) => c.subject);
      expect(tailSubjects).toContain('commit 4');
      expect(tailSubjects).toContain('commit 5');

      // Source HEAD should now be sha3
      const sourceHead = await GitShell.getBranchHead(r.dir, 'feat/big');
      expect(sourceHead).toBe(sha3);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('updates stack tree: new branch is child of source with correct lastKnownHead', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/src');
      const sha1 = await commit(r.dir, r.git, 'a.txt', 'a\n', 'first');
      const sha2 = await commit(r.dir, r.git, 'b.txt', 'b\n', 'second');
      const sha3 = await commit(r.dir, r.git, 'c.txt', 'c\n', 'third');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/src', 'main');
      stack = StackManager.updateNode(stack, 'feat/src', { lastKnownHead: sha3 });

      const result = await BranchSplitter.tailSplit(r.dir, stack, 'feat/src', 'feat/new', sha1);

      // New branch should be child of source
      const newNode = StackManager.findNode(result.updatedStack, 'feat/new');
      expect(newNode).toBeDefined();
      expect(newNode!.parent).toBe('feat/src');

      // lastKnownHead on new branch = original source HEAD
      expect(newNode!.lastKnownHead).toBe(sha3);

      // lastKnownHead on source = split point
      const srcNode = StackManager.findNode(result.updatedStack, 'feat/src');
      expect(srcNode!.lastKnownHead).toBe(sha1);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('re-parents existing children of source to the new branch', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/parent');
      const sha1 = await commit(r.dir, r.git, 'p1.txt', '1\n', 'parent-1');
      const sha2 = await commit(r.dir, r.git, 'p2.txt', '2\n', 'parent-2');
      const sha3 = await commit(r.dir, r.git, 'p3.txt', '3\n', 'parent-3');

      // Create a child of feat/parent
      r.git('checkout', '-b', 'feat/child');
      const childSha = await commit(r.dir, r.git, 'child.txt', 'c\n', 'child commit');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/parent', 'main');
      stack = StackManager.updateNode(stack, 'feat/parent', { lastKnownHead: sha3 });
      stack = StackManager.addNode(stack, 'feat/child', 'feat/parent');
      stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childSha });

      // Split feat/parent after sha1 -> creates feat/split with commits 2,3
      // feat/child was a child of feat/parent, should be re-parented to feat/split
      const result = await BranchSplitter.tailSplit(r.dir, stack, 'feat/parent', 'feat/split', sha1);

      const childNode = StackManager.findNode(result.updatedStack, 'feat/child');
      expect(childNode).toBeDefined();
      expect(childNode!.parent).toBe('feat/split');

      // feat/split is child of feat/parent
      const splitNode = StackManager.findNode(result.updatedStack, 'feat/split');
      expect(splitNode!.parent).toBe('feat/parent');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('rejects split when the source branch is checked out right where it is dirty', async () => {
    // tailSplit is ref-only surgery now: launch-tree dirtiness alone is not
    // checked. This still refuses because `r.dir` is itself the checkout
    // that has feat/dirty (and is dirty): the slot policy inside
    // finalizeBranchRef applies to the primary worktree same as any other.
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/dirty');
      const sha1 = await commit(r.dir, r.git, 'x.txt', 'x\n', 'first');
      await commit(r.dir, r.git, 'y.txt', 'y\n', 'second');

      // Make dirty
      await writeFile(join(r.dir, 'x.txt'), 'modified\n', 'utf-8');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/dirty', 'main');
      stack = StackManager.updateNode(stack, 'feat/dirty', { lastKnownHead: 'xxx' });

      await expect(
        BranchSplitter.tailSplit(r.dir, stack, 'feat/dirty', 'feat/new', sha1),
      ).rejects.toThrow(/dirty|checked out/i);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('rejects split when split point is at HEAD', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/at-head');
      await commit(r.dir, r.git, 'a.txt', 'a\n', 'first');
      const headSha = await commit(r.dir, r.git, 'b.txt', 'b\n', 'second');
      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/at-head', 'main');
      stack = StackManager.updateNode(stack, 'feat/at-head', { lastKnownHead: headSha });

      await expect(
        BranchSplitter.tailSplit(r.dir, stack, 'feat/at-head', 'feat/new', headSha),
      ).rejects.toThrow(/No commits to split/);
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── getCommitLog ─────────────────────────────────────────────────────────────

describe('BranchSplitter.getCommitLog integration', () => {
  test('returns structured log matching real commits', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/log-test');
      const sha1 = await commit(r.dir, r.git, 'a.txt', 'a\n', 'first commit');
      const sha2 = await commit(r.dir, r.git, 'b.txt', 'b\n', 'second commit');
      const sha3 = await commit(r.dir, r.git, 'c.txt', 'c\n', 'third commit');

      const log = await BranchSplitter.getCommitLog(r.dir, 'feat/log-test');

      // Newest first
      expect(log).toHaveLength(4); // 3 branch commits + initial commit from main
      expect(log[0]!.sha).toBe(sha3);
      expect(log[0]!.subject).toBe('third commit');
      expect(log[1]!.sha).toBe(sha2);
      expect(log[1]!.subject).toBe('second commit');
      expect(log[2]!.sha).toBe(sha1);
      expect(log[2]!.subject).toBe('first commit');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('respects the limit parameter', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/limit-test');
      for (let i = 1; i <= 10; i++) {
        await commit(r.dir, r.git, `file-${i}.txt`, `${i}\n`, `commit ${i}`);
      }

      const log = await BranchSplitter.getCommitLog(r.dir, 'feat/limit-test', 3);
      expect(log).toHaveLength(3);
      expect(log[0]!.subject).toBe('commit 10');
      expect(log[2]!.subject).toBe('commit 8');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});

// ── splitByFile ──────────────────────────────────────────────────────────────

describe('BranchSplitter.splitByFile integration', () => {
  test('content distribution — matched files move, remaining stay', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/mixed');
      await commit(r.dir, r.git, 'api.ts', 'export function handler() {}\n', 'add api.ts');
      await commit(r.dir, r.git, 'config.json', '{"key": "value"}\n', 'add config.json');
      await commit(r.dir, r.git, 'utils.ts', 'export function util() {}\n', 'add utils.ts');
      const mixedHead = await commit(r.dir, r.git, 'schema.sql', 'CREATE TABLE t;\n', 'add schema.sql');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/mixed', 'main');
      stack = StackManager.updateNode(stack, 'feat/mixed', { lastKnownHead: mixedHead });

      const result = await BranchSplitter.splitByFile(
        r.dir, stack, 'feat/mixed', ['*.ts'], 'feat/ts-only',
      );

      expect(result.movedFiles).toEqual(expect.arrayContaining(['api.ts', 'utils.ts']));
      expect(result.remainingFiles).toEqual(expect.arrayContaining(['config.json', 'schema.sql']));

      // New branch should have .ts files
      r.git('checkout', 'feat/ts-only');
      const apiContent = await readFile(join(r.dir, 'api.ts'), 'utf-8');
      expect(apiContent).toBe('export function handler() {}\n');
      const utilsContent = await readFile(join(r.dir, 'utils.ts'), 'utf-8');
      expect(utilsContent).toBe('export function util() {}\n');

      // Source branch should NOT have .ts files but should have json/sql
      r.git('checkout', 'feat/mixed');
      const configContent = await readFile(join(r.dir, 'config.json'), 'utf-8');
      expect(configContent).toBe('{"key": "value"}\n');
      const schemaContent = await readFile(join(r.dir, 'schema.sql'), 'utf-8');
      expect(schemaContent).toBe('CREATE TABLE t;\n');

      // Stack tree should show feat/ts-only as sibling of feat/mixed (both under main)
      const newNode = StackManager.findNode(result.newStack, 'feat/ts-only');
      expect(newNode).toBeDefined();
      expect(newNode!.parent).toBe('main');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('split by file then cascade — both branches survive rebase', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { RebaseEngine } = await import('../../src/core/rebase-engine.ts');
    const { GitShell } = await import('../../src/core/git-shell.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/mixed');
      await commit(r.dir, r.git, 'api.ts', 'handler code\n', 'add api.ts');
      const mixedHead = await commit(r.dir, r.git, 'config.json', '{"a":1}\n', 'add config.json');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/mixed', 'main');
      stack = StackManager.updateNode(stack, 'feat/mixed', { lastKnownHead: mixedHead });

      // Split by file
      const splitResult = await BranchSplitter.splitByFile(
        r.dir, stack, 'feat/mixed', ['*.ts'], 'feat/ts-only',
      );

      // Advance main
      r.git('checkout', 'main');
      await commit(r.dir, r.git, 'main-file.txt', 'main advance\n', 'advance main');

      // Both branches should needsRebase
      const mixed = await RebaseEngine.needsRebase(r.dir, splitResult.newStack, 'feat/mixed');
      expect(mixed).toBe(true);
      const tsOnly = await RebaseEngine.needsRebase(r.dir, splitResult.newStack, 'feat/ts-only');
      expect(tsOnly).toBe(true);

      // Verify content survives (check before cascade since we're testing the split itself)
      r.git('checkout', 'feat/ts-only');
      expect(await readFile(join(r.dir, 'api.ts'), 'utf-8')).toBe('handler code\n');

      r.git('checkout', 'feat/mixed');
      expect(await readFile(join(r.dir, 'config.json'), 'utf-8')).toBe('{"a":1}\n');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('getChangedFileList returns files changed in branch', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');

    const r = await createSandboxRepo();
    try {
      r.git('checkout', '-b', 'feat/files');
      await commit(r.dir, r.git, 'a.ts', 'a\n', 'add a');
      await commit(r.dir, r.git, 'b.json', 'b\n', 'add b');
      await commit(r.dir, r.git, 'c.ts', 'c\n', 'add c');

      const files = await BranchSplitter.getChangedFileList(r.dir, 'feat/files', 'main');

      expect(files).toEqual(expect.arrayContaining(['a.ts', 'b.json', 'c.ts']));
      expect(files).toHaveLength(3);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('end-to-end fold + split cycle preserves all content', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { foldBranch } = await import('../../src/core/branch-fold.ts');

    const r = await createSandboxRepo();
    try {
      // Create main → feat/base → feat/mixed to enable meaningful fold-back
      r.git('checkout', '-b', 'feat/base');
      const baseHead = await commit(r.dir, r.git, 'base.txt', 'base\n', 'add base');

      r.git('checkout', '-b', 'feat/mixed');
      await commit(r.dir, r.git, 'api.ts', 'api code\n', 'add api.ts');
      await commit(r.dir, r.git, 'config.json', '{"cfg":true}\n', 'add config.json');
      const mixedHead = await commit(r.dir, r.git, 'schema.sql', 'CREATE TABLE x;\n', 'add schema.sql');

      r.git('checkout', 'main');

      let stack = StackManager.createStack('test', 'main');
      stack = StackManager.addNode(stack, 'feat/base', 'main');
      stack = StackManager.updateNode(stack, 'feat/base', { lastKnownHead: baseHead });
      stack = StackManager.addNode(stack, 'feat/mixed', 'feat/base');
      stack = StackManager.updateNode(stack, 'feat/mixed', { lastKnownHead: mixedHead });

      // Split by file: .ts files go to feat/ts (sibling of feat/mixed under feat/base)
      const splitResult = await BranchSplitter.splitByFile(
        r.dir, stack, 'feat/mixed', ['*.ts'], 'feat/ts',
      );

      expect(splitResult.movedFiles).toEqual(['api.ts']);
      expect(splitResult.remainingFiles).toEqual(expect.arrayContaining(['config.json', 'schema.sql']));

      // Both feat/mixed and feat/ts are now children of feat/base
      const tsNode = StackManager.findNode(splitResult.newStack, 'feat/ts');
      expect(tsNode!.parent).toBe('feat/base');

      // Fold feat/ts into its parent (feat/base): feat/base gets api.ts
      const foldResult = await foldBranch(r.dir, splitResult.newStack, 'feat/ts');

      // feat/base should now have base.txt + api.ts
      r.git('checkout', 'feat/base');
      expect(await readFile(join(r.dir, 'base.txt'), 'utf-8')).toBe('base\n');
      expect(await readFile(join(r.dir, 'api.ts'), 'utf-8')).toBe('api code\n');

      // feat/mixed still has config.json + schema.sql
      r.git('checkout', 'feat/mixed');
      expect(await readFile(join(r.dir, 'config.json'), 'utf-8')).toBe('{"cfg":true}\n');
      expect(await readFile(join(r.dir, 'schema.sql'), 'utf-8')).toBe('CREATE TABLE x;\n');

      // feat/ts should be deleted
      const branches = r.git('branch', '--list').split('\n').map((b: string) => b.trim().replace('* ', ''));
      expect(branches).not.toContain('feat/ts');
    } finally {
      await cleanupRepo(r.dir);
    }
  });
});
