import { describe, test, expect, afterEach } from 'bun:test';
import { writeFile, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitShell } from '../../src/core/git-shell.ts';
import { RebaseEngine } from '../../src/core/rebase-engine.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { AbsorbEngine } from '../../src/core/absorb.ts';
import { BranchSplitter } from '../../src/core/branch-splitter.ts';
import { foldBranch } from '../../src/core/branch-fold.ts';
import {
  createSandboxRepoWithRemote,
  cleanupRepo,
  commit,
  buildLinearStack,
  type SandboxRepoWithRemote,
} from './helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await cleanupRepo(d);
  dirs.length = 0;
});

// ── Helper: push all stack branches to origin ────────────────────────────────

async function pushAllBranches(dir: string, git: (...args: string[]) => string, branches: string[]) {
  for (const branch of branches) {
    git('push', '-u', 'origin', branch);
  }
}

// ── Helper: simulate external push to remote ─────────────────────────────────

async function externalPushToMain(remoteDir: string, filename: string, content: string) {
  const cloneDir = await mkdtemp(join(tmpdir(), 'gitq-ext-'));
  try {
    execFileSync('git', ['clone', remoteDir, cloneDir], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'ext@gitq.dev'], { cwd: cloneDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'External'], { cwd: cloneDir, stdio: 'pipe' });
    await writeFile(join(cloneDir, filename), content, 'utf-8');
    execFileSync('git', ['add', '.'], { cwd: cloneDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `external: add ${filename}`], { cwd: cloneDir, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: cloneDir, stdio: 'pipe' });
  } finally {
    await cleanupRepo(cloneDir);
  }
}

// ── Full create → push → sync → cascade → push cycle ────────────────────────

describe('Full remote cycle: create → push → sync → cascade → push', () => {
  test('complete lifecycle with remote main advance', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // 1. Build a 3-branch stack
    r.git('checkout', '-b', 'feat/auth');
    await commit(r.dir, r.git, 'auth.ts', 'export function login() {}\n', 'feat/auth: add login');
    await commit(r.dir, r.git, 'auth.test.ts', 'test("login")\n', 'feat/auth: add test');

    r.git('checkout', '-b', 'feat/session');
    await commit(r.dir, r.git, 'session.ts', 'export class Session {}\n', 'feat/session: add session');

    r.git('checkout', '-b', 'feat/middleware');
    await commit(r.dir, r.git, 'middleware.ts', 'export function auth() {}\n', 'feat/middleware: add middleware');

    r.git('checkout', 'main');

    let stack = StackManager.createStack('auth-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/auth', 'main');
    stack = StackManager.updateNode(stack, 'feat/auth', { lastKnownHead: r.git('rev-parse', 'feat/auth') });
    stack = StackManager.addNode(stack, 'feat/session', 'feat/auth');
    stack = StackManager.updateNode(stack, 'feat/session', { lastKnownHead: r.git('rev-parse', 'feat/session') });
    stack = StackManager.addNode(stack, 'feat/middleware', 'feat/session');
    stack = StackManager.updateNode(stack, 'feat/middleware', { lastKnownHead: r.git('rev-parse', 'feat/middleware') });

    // 2. Push all branches
    await pushAllBranches(r.dir, r.git, ['feat/auth', 'feat/session', 'feat/middleware']);

    // Verify remote has branches
    const remoteRefs = r.git('ls-remote', '--heads', 'origin');
    expect(remoteRefs).toContain('feat/auth');
    expect(remoteRefs).toContain('feat/session');
    expect(remoteRefs).toContain('feat/middleware');

    // 3. Someone else pushes to main
    await externalPushToMain(r.remoteDir, 'hotfix.ts', 'export function fix() {}\n');

    // 4. Sync: fetch + cascade
    const syncResult = await RebaseEngine.syncLocalStack(r.dir, stack);

    expect(syncResult.state).toBe('completed');

    // 5. Verify local main is untouched (gitq doesn't touch trunk) — sync
    // rebases stack branches directly onto origin/main, per syncLocalStack's contract.
    const mainHead = await GitShell.getBranchHead(r.dir, 'main');
    const remoteMainHead = await GitShell.getBranchHead(r.dir, 'origin/main');
    expect(mainHead).not.toBe(remoteMainHead);

    // 6. Verify the hotfix file exists on origin/main
    r.git('checkout', 'origin/main');
    expect(await readFile(join(r.dir, 'hotfix.ts'), 'utf-8')).toBe('export function fix() {}\n');

    // 7. Verify entire stack is rebased on new origin/main
    const mbAuth = await GitShell.getMergeBase(r.dir, 'origin/main', 'feat/auth');
    expect(mbAuth).toBe(remoteMainHead);

    const authHead = await GitShell.getBranchHead(r.dir, 'feat/auth');
    const mbSession = await GitShell.getMergeBase(r.dir, 'feat/auth', 'feat/session');
    expect(mbSession).toBe(authHead);

    const sessionHead = await GitShell.getBranchHead(r.dir, 'feat/session');
    const mbMiddleware = await GitShell.getMergeBase(r.dir, 'feat/session', 'feat/middleware');
    expect(mbMiddleware).toBe(sessionHead);

    // 8. Verify file contents survive the cascade
    r.git('checkout', 'feat/middleware');
    expect(await readFile(join(r.dir, 'auth.ts'), 'utf-8')).toBe('export function login() {}\n');
    expect(await readFile(join(r.dir, 'session.ts'), 'utf-8')).toBe('export class Session {}\n');
    expect(await readFile(join(r.dir, 'middleware.ts'), 'utf-8')).toBe('export function auth() {}\n');
    expect(await readFile(join(r.dir, 'hotfix.ts'), 'utf-8')).toBe('export function fix() {}\n');

    // 9. Force-push all branches
    for (const branch of ['feat/auth', 'feat/session', 'feat/middleware']) {
      await GitShell.pushForceWithLease(r.dir, branch);
      const localHead = r.git('rev-parse', branch);
      const remoteHead = r.git('ls-remote', 'origin', branch);
      expect(remoteHead).toContain(localHead);
    }
  });

  test('push rejects when remote diverged — force-push lease protects', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // Push a branch
    r.git('checkout', '-b', 'feat/guarded');
    await commit(r.dir, r.git, 'guard.txt', 'v1\n', 'initial');
    r.git('push', '-u', 'origin', 'feat/guarded');

    // Someone else pushes to the same branch from another clone
    const otherDir = await mkdtemp(join(tmpdir(), 'gitq-other-'));
    dirs.push(otherDir);
    execFileSync('git', ['clone', r.remoteDir, otherDir], { stdio: 'pipe' });
    execFileSync('git', ['checkout', 'feat/guarded'], { cwd: otherDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'other@gitq.dev'], { cwd: otherDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Other'], { cwd: otherDir, stdio: 'pipe' });
    await writeFile(join(otherDir, 'other.txt'), 'other\n', 'utf-8');
    execFileSync('git', ['add', '.'], { cwd: otherDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'other push'], { cwd: otherDir, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'feat/guarded'], { cwd: otherDir, stdio: 'pipe' });

    // Local commit diverges
    await commit(r.dir, r.git, 'local.txt', 'local\n', 'local diverge');

    // Force-push with lease should reject
    await expect(
      GitShell.pushForceWithLease(r.dir, 'feat/guarded'),
    ).rejects.toThrow();
  });
});

// ── Squash-merge + cascade + push ────────────────────────────────────────────

describe('Squash-merge on remote → cascade → push', () => {
  test('squash-merge base branch, cascade child onto main, push', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    // Build: main → feat/base → feat/child
    r.git('checkout', '-b', 'feat/base');
    await commit(r.dir, r.git, 'base.ts', 'base code\n', 'add base');
    const baseHead = r.git('rev-parse', 'HEAD');

    r.git('checkout', '-b', 'feat/child');
    await commit(r.dir, r.git, 'child.ts', 'child code\n', 'add child');
    const childHead = r.git('rev-parse', 'HEAD');

    r.git('checkout', 'main');
    await pushAllBranches(r.dir, r.git, ['feat/base', 'feat/child']);

    // Squash-merge feat/base into main
    r.git('merge', '--squash', 'feat/base');
    r.git('commit', '-m', 'squash: feat/base');
    const mainHead = r.git('rev-parse', 'HEAD');
    r.git('push', 'origin', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/base', 'main');
    stack = StackManager.updateNode(stack, 'feat/base', {
      lastKnownHead: baseHead,
      status: 'merged',
    });
    stack = StackManager.addNode(stack, 'feat/child', 'feat/base');
    stack = StackManager.updateNode(stack, 'feat/child', { lastKnownHead: childHead });

    // Cascade feat/child onto main
    const result = await RebaseEngine.cascadeRebase(r.dir, stack, 'feat/base', 'main');

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.success).toBe(true);

    // feat/child sits on main
    const mb = await GitShell.getMergeBase(r.dir, 'main', 'feat/child');
    expect(mb).toBe(mainHead);

    // Push feat/child
    await GitShell.pushForceWithLease(r.dir, 'feat/child');

    const localHead = r.git('rev-parse', 'feat/child');
    const remoteRef = r.git('ls-remote', 'origin', 'feat/child');
    expect(remoteRef).toContain(localHead);

    // Verify file content survived
    r.git('checkout', 'feat/child');
    expect(await readFile(join(r.dir, 'base.ts'), 'utf-8')).toBe('base code\n');
    expect(await readFile(join(r.dir, 'child.ts'), 'utf-8')).toBe('child code\n');
  });
});

// ── Sync twice in a row ──────────────────────────────────────────────────────

describe('Double sync resilience', () => {
  test('syncing twice when remote has not changed is a safe no-op', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    r.git('checkout', '-b', 'feat/a');
    await commit(r.dir, r.git, 'a.txt', 'a\n', 'add a');
    r.git('push', '-u', 'origin', 'feat/a');
    r.git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', { lastKnownHead: r.git('rev-parse', 'feat/a') });

    // Advance remote
    await externalPushToMain(r.remoteDir, 'ext.txt', 'ext\n');

    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      // First sync
      const result1 = await RebaseEngine.syncLocalStack(r.dir, stack);
      expect(result1.state).toBe('completed');

      const aHeadAfter1 = r.git('rev-parse', 'feat/a');

      // Second sync — no new remote changes
      const result2 = await RebaseEngine.syncLocalStack(r.dir, result1.updatedStack);
      expect(result2.state).toBe('completed');

      // feat/a HEAD should not change on second sync
      const aHeadAfter2 = r.git('rev-parse', 'feat/a');
      expect(aHeadAfter2).toBe(aHeadAfter1);
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});

// ── Absorb + push cycle ──────────────────────────────────────────────────────

describe('Absorb + push cycle with remote', () => {
  test('absorb distributes changes, cascade restacks, push succeeds', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    r.git('checkout', '-b', 'branch-1');
    const sha1 = await commit(r.dir, r.git, 'api.ts', 'export function api() {}\n', 'add api');
    r.git('checkout', '-b', 'branch-2');
    const sha2 = await commit(r.dir, r.git, 'config.json', '{"key":"value"}\n', 'add config');
    r.git('checkout', 'main');

    await pushAllBranches(r.dir, r.git, ['branch-1', 'branch-2']);

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'branch-1', 'main');
    stack = StackManager.updateNode(stack, 'branch-1', { lastKnownHead: sha1 });
    stack = StackManager.addNode(stack, 'branch-2', 'branch-1');
    stack = StackManager.updateNode(stack, 'branch-2', { lastKnownHead: sha2 });

    r.git('checkout', 'branch-2');

    // Modify a file owned by branch-1
    await writeFile(join(r.dir, 'api.ts'), 'export function api() { return "updated"; }\n');

    const result = await AbsorbEngine.absorb(r.dir, stack);
    expect(result.absorbed).toBe(true);

    // Push both branches after absorb
    for (const branch of ['branch-1', 'branch-2']) {
      await GitShell.pushForceWithLease(r.dir, branch);
      const localHead = r.git('rev-parse', branch);
      const remoteRef = r.git('ls-remote', 'origin', branch);
      expect(remoteRef).toContain(localHead);
    }

    // Verify content on remote
    r.git('checkout', 'branch-1');
    expect(await readFile(join(r.dir, 'api.ts'), 'utf-8')).toContain('updated');
  });
});

// ── Split + push + sync cycle ────────────────────────────────────────────────

describe('Split + push + sync cycle', () => {
  test('split a branch, push both halves, sync after remote advance', async () => {
    const r = await createSandboxRepoWithRemote();
    dirs.push(r.dir, r.remoteDir);

    r.git('checkout', '-b', 'feat/big');
    const sha1 = await commit(r.dir, r.git, 'f1.txt', '1\n', 'commit 1');
    const sha2 = await commit(r.dir, r.git, 'f2.txt', '2\n', 'commit 2');
    const sha3 = await commit(r.dir, r.git, 'f3.txt', '3\n', 'commit 3');
    const sha4 = await commit(r.dir, r.git, 'f4.txt', '4\n', 'commit 4');
    r.git('checkout', 'main');

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/big', 'main');
    stack = StackManager.updateNode(stack, 'feat/big', { lastKnownHead: sha4 });

    // Split after commit 2
    const splitResult = await BranchSplitter.tailSplit(r.dir, stack, 'feat/big', 'feat/tail', sha2);

    // Push both
    r.git('push', '-u', 'origin', 'feat/big');
    r.git('push', '-u', 'origin', 'feat/tail');

    // External advance main
    await externalPushToMain(r.remoteDir, 'ext.txt', 'ext\n');

    // Sync
    const originalPush = GitShell.pushForceWithLease;
    GitShell.pushForceWithLease = async () => {};

    try {
      const syncResult = await RebaseEngine.syncLocalStack(r.dir, splitResult.updatedStack);
      expect(syncResult.state).toBe('completed');

      // Verify both branches are on updated main
      const mainHead = await GitShell.getBranchHead(r.dir, 'main');
      const mbBig = await GitShell.getMergeBase(r.dir, 'main', 'feat/big');
      expect(mbBig).toBe(mainHead);

      // feat/tail should be on top of feat/big
      const bigHead = await GitShell.getBranchHead(r.dir, 'feat/big');
      const mbTail = await GitShell.getMergeBase(r.dir, 'feat/big', 'feat/tail');
      expect(mbTail).toBe(bigHead);

      // Content intact
      r.git('checkout', 'feat/tail');
      expect(await readFile(join(r.dir, 'f3.txt'), 'utf-8')).toBe('3\n');
      expect(await readFile(join(r.dir, 'f4.txt'), 'utf-8')).toBe('4\n');
    } finally {
      GitShell.pushForceWithLease = originalPush;
    }
  });
});
