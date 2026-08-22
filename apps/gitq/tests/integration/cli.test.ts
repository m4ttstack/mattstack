import { afterEach, describe, expect, test } from 'bun:test';
import { basename, join } from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  createSandboxRepo,
  createSandboxRepoWithRemote,
  cleanupRepo,
  buildLinearStack,
  commit,
  addNamedWorktree,
  addWorkSlot,
  runCli,
  type SandboxRepo,
  type SandboxRepoWithRemote,
} from './helpers.ts';
import { COMMANDS } from '../../src/cli/main.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore, resolveRepoIdentity } from '../../src/core/persistence.ts';
import { OperationLog } from '../../src/core/operation-log.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { listLeases } from '../../src/core/leases.ts';
import type { Stack } from '../../src/core/types.ts';

const BIN = join(import.meta.dir, '../../bin/gitq');
export { runCli };

/**
 * Resolve a worktree's real git dir (worktree-safe: `.git` there is a file
 * pointing back at the main repo's `.git/worktrees/<name>`), the same way
 * `src/cli/slots.ts#slotGitDir` does. This keeps pause-file assertions
 * looking in the same place the CLI writes to.
 */
function gitDirOf(worktreePath: string): string {
  return execFileSync('git', ['-C', worktreePath, 'rev-parse', '--absolute-git-dir'], { stdio: 'pipe' })
    .toString()
    .trim();
}


// Dirs created by makeRepo() in the current test, cleaned up in afterEach.
// Tests added later in this file inherit cleanup for free by going through makeRepo().
let dirsToClean: string[] = [];

/** Create a sandbox repo + sibling config dir, registering both for afterEach cleanup. */
async function makeRepo() {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  return { repo, configDir };
}

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
});

/**
 * Create a sandbox repo + sibling config dir (via makeRepo()), build a real
 * linear stack of `depth` branches in it, and persist that stack to the
 * sibling config dir via saveStore. `setConfigDir` is realpath-safe here
 * because `repo.dir` already comes from createSandboxRepo's realpathSync.
 */
async function makeRepoWithStack(depth = 2): Promise<{ repo: Awaited<ReturnType<typeof createSandboxRepo>>; configDir: string; stack: Stack }> {
  const { repo, configDir } = await makeRepo();
  const { stack } = await buildLinearStack(repo.dir, repo.git, depth);
  setConfigDir(configDir);
  await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
  return { repo, configDir, stack };
}

/**
 * Build a one-branch stack that is guaranteed to conflict on `gitq sync`:
 * trunk (origin/main) and the tracked branch both edit the same line of
 * shared.txt after forking from a common commit. Mirrors the conflict
 * fixture in tests/integration/cascade-rebase.test.ts, but wired through a
 * real remote (createSandboxRepoWithRemote) and the CLI's track/add commands
 * since `gitq sync` fetches from origin.
 */
async function makeConflictedStack(): Promise<{ repo: SandboxRepoWithRemote; configDir: string }> {
  const repo = await createSandboxRepoWithRemote();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir, repo.remoteDir);

  // Common ancestor commit, pushed so origin/main and the branch share it.
  await commit(repo.dir, repo.git, 'shared.txt', 'line one\nline two\nline three\n', 'add shared.txt');
  repo.git('push', 'origin', 'main');

  // Branch edits the middle line.
  repo.git('checkout', '-b', 'feat/conflict');
  await commit(repo.dir, repo.git, 'shared.txt', 'line one\nbranch change\nline three\n', 'feat/conflict: edit shared.txt');
  repo.git('checkout', 'main');

  // Simulate an external push to trunk that edits the same line differently,
  // so origin/main advances without moving local main (gitq never touches trunk).
  const cloneDir = await mkdtemp(join(tmpdir(), 'gitq-ext-'));
  dirsToClean.push(cloneDir);
  execFileSync('git', ['clone', repo.remoteDir, cloneDir], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'ext@gitq.dev'], { cwd: cloneDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'External'], { cwd: cloneDir, stdio: 'pipe' });
  await writeFile(join(cloneDir, 'shared.txt'), 'line one\ntrunk change\nline three\n', 'utf-8');
  execFileSync('git', ['add', 'shared.txt'], { cwd: cloneDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'trunk: edit shared.txt'], { cwd: cloneDir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: cloneDir, stdio: 'pipe' });

  await runCli(['track', 'conflict-stack', '--root', 'main'], repo.dir, configDir);
  await runCli(['add', 'feat/conflict', '--parent', 'main'], repo.dir, configDir);

  return { repo, configDir };
}

/**
 * Variant of makeConflictedStack() where the tracked branch has TWO commits
 * that both touch the same line of shared.txt, the second building on the
 * first. Used to drive a re-pause: resolving the first rebase conflict by
 * keeping the rebase target's content (`git checkout --ours` — during a
 * rebase "ours" is the branch being rebased *onto*, not the replayed commit)
 * leaves the second commit's patch expecting content that's no longer
 * there, so it conflicts again on `gitq continue`.
 */
async function makeDoubleConflictedStack(): Promise<{ repo: SandboxRepoWithRemote; configDir: string }> {
  const repo = await createSandboxRepoWithRemote();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir, repo.remoteDir);

  await commit(repo.dir, repo.git, 'shared.txt', 'line one\nline two\nline three\n', 'add shared.txt');
  repo.git('push', 'origin', 'main');

  repo.git('checkout', '-b', 'feat/conflict');
  await commit(repo.dir, repo.git, 'shared.txt', 'line one\nbranch change 1\nline three\n', 'feat/conflict: commit1');
  await commit(repo.dir, repo.git, 'shared.txt', 'line one\nbranch change 2\nline three\n', 'feat/conflict: commit2');
  repo.git('checkout', 'main');

  const cloneDir = await mkdtemp(join(tmpdir(), 'gitq-ext-'));
  dirsToClean.push(cloneDir);
  execFileSync('git', ['clone', repo.remoteDir, cloneDir], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'ext@gitq.dev'], { cwd: cloneDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'External'], { cwd: cloneDir, stdio: 'pipe' });
  await writeFile(join(cloneDir, 'shared.txt'), 'line one\ntrunk change\nline three\n', 'utf-8');
  execFileSync('git', ['add', 'shared.txt'], { cwd: cloneDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'trunk: edit shared.txt'], { cwd: cloneDir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: cloneDir, stdio: 'pipe' });

  await runCli(['track', 'conflict-stack', '--root', 'main'], repo.dir, configDir);
  await runCli(['add', 'feat/conflict', '--parent', 'main'], repo.dir, configDir);

  return { repo, configDir };
}

/**
 * Build main → b1 → b2 where absorb amends the ANCESTOR (b1) and the descendant
 * restack (b2) then conflicts. b1 net-touches F.txt; b2 touches F.txt in its
 * first commit but reverts it in its second (adding other.txt), so F.txt's net
 * diff belongs to b1 — attribution amends b1 — yet replaying b2's first commit
 * onto the amended b1 collides. The tree is left on b2 with an uncommitted F.txt
 * change ready to absorb. Store persisted to the sibling config dir.
 */
async function makeAbsorbCascadeConflictRepo(): Promise<{ repo: SandboxRepo; configDir: string }> {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  setConfigDir(configDir);
  const { dir, git } = repo;

  await commit(dir, git, 'F.txt', 'base\n', 'main: add F');
  let stack = StackManager.createStack('absorb-cascade', 'main');

  git('checkout', '-b', 'b1');
  const b1 = await commit(dir, git, 'F.txt', 'b1v\n', 'b1: F->b1v');
  stack = StackManager.addNode(stack, 'b1', 'main');
  stack = StackManager.updateNode(stack, 'b1', { lastKnownHead: b1 });

  git('checkout', '-b', 'b2');
  await commit(dir, git, 'F.txt', 'b2mid\n', 'b2: F->b2mid');
  // Second commit reverts F.txt to b1's version (net-zero on F across b1..b2)
  // and adds other.txt, so F.txt is attributed to b1, not b2.
  await writeFile(join(dir, 'F.txt'), 'b1v\n', 'utf-8');
  await writeFile(join(dir, 'other.txt'), 'o\n', 'utf-8');
  git('add', '-A');
  git('commit', '-m', 'b2: revert F, add other.txt');
  const b2 = git('rev-parse', 'HEAD');
  stack = StackManager.addNode(stack, 'b2', 'b1');
  stack = StackManager.updateNode(stack, 'b2', { lastKnownHead: b2 });

  await saveStore(dir, { repoPath: dir, remoteUrl: '', stacks: [stack] });

  // Uncommitted change to F.txt (attributed to b1, the deepest net toucher).
  git('checkout', 'b2');
  await writeFile(join(dir, 'F.txt'), 'wt\n', 'utf-8');

  return { repo, configDir };
}

/**
 * Build main → b1 → b2 plus a sibling `sib` off main. Reparenting b1 onto sib
 * rebases b1 cleanly (b1 edits line 5, sib edits line 2 — disjoint), but the
 * descendant cascade of b2 (which edits line 2) then conflicts on F.txt against
 * sib's line-2 change. Store persisted to the sibling config dir.
 */
async function makeReparentCascadeConflictRepo(): Promise<{ repo: SandboxRepo; configDir: string }> {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  setConfigDir(configDir);
  const { dir, git } = repo;

  await commit(dir, git, 'F.txt', 'L1\nL2\nL3\nL4\nL5\n', 'main: add F');
  let stack = StackManager.createStack('reparent-cascade', 'main');

  git('checkout', '-b', 'b1');
  const b1 = await commit(dir, git, 'F.txt', 'L1\nL2\nL3\nL4\nXXX\n', 'b1: L5->XXX');
  stack = StackManager.addNode(stack, 'b1', 'main');
  stack = StackManager.updateNode(stack, 'b1', { lastKnownHead: b1 });

  git('checkout', '-b', 'b2');
  const b2 = await commit(dir, git, 'F.txt', 'L1\nYYY\nL3\nL4\nXXX\n', 'b2: L2->YYY');
  stack = StackManager.addNode(stack, 'b2', 'b1');
  stack = StackManager.updateNode(stack, 'b2', { lastKnownHead: b2 });

  git('checkout', 'main');
  git('checkout', '-b', 'sib');
  const sib = await commit(dir, git, 'F.txt', 'L1\nSIB\nL3\nL4\nL5\n', 'sib: L2->SIB');
  stack = StackManager.addNode(stack, 'sib', 'main');
  stack = StackManager.updateNode(stack, 'sib', { lastKnownHead: sib });

  git('checkout', 'main');
  await saveStore(dir, { repoPath: dir, remoteUrl: '', stacks: [stack] });

  return { repo, configDir };
}

/** True if git is mid-rebase in a plain (non-worktree) sandbox repo. */
function rebaseInProgress(repoDir: string): boolean {
  return (
    existsSync(join(repoDir, '.git', 'rebase-merge')) ||
    existsSync(join(repoDir, '.git', 'rebase-apply'))
  );
}

describe('gitq CLI', () => {
  test('stacks --json on a repo with no stacks', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['stacks', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).stacks).toEqual([]);
  });

  test('unknown command exits 1', async () => {
    const { repo, configDir } = await makeRepo();
    const { exitCode, stderr } = await runCli(['nonsense'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown command');
  });

  test('-C <repoDir> resolves context from a different cwd', async () => {
    const { repo, configDir } = await makeRepo();
    // Assumes the temp dir's parent (join(repo.dir, '..')) is not itself inside a git repo,
    // otherwise `-C` context resolution could pick up that outer repo instead.
    const { stdout, exitCode } = await runCli(['-C', repo.dir, 'stacks', '--json'], join(repo.dir, '..'), configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).stacks).toEqual([]);
  });

  test('diagnose --json reports situations for a healthy stack', async () => {
    const { repo, configDir, stack } = await makeRepoWithStack(2);
    const { stdout, exitCode } = await runCli(['diagnose', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.stacks).toHaveLength(1);
    expect(parsed.stacks[0].stackName).toBe(stack.stackName);
    const nodes = parsed.stacks[0].diagnostics.nodes;
    expect(nodes.length).toBe(2);

    // Value-level assertions on the flattened node (nodes.length alone doesn't
    // catch a broken/empty NodeDirective surviving the Map -> array flatten).
    const firstNode = nodes[0];
    expect(firstNode.branch).toBe(stack.nodes[0]!.branch);
    expect(typeof firstNode.situation).toBe('string');
    expect(firstNode.situation.length).toBeGreaterThan(0);
    // statusLine is the field NodeDirective guarantees non-null (`badge` is
    // `{ ... } | null`); assert on the one the type actually promises.
    expect(typeof firstNode.statusLine).toBe('string');
    expect(firstNode.statusLine.length).toBeGreaterThan(0);
  });

  test('preflight --json reports a clean report for a healthy stack', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    const { stdout, exitCode } = await runCli(['preflight', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.stacks).toHaveLength(1);
    expect(parsed.stacks[0].report.dirty).toBe(false);
    expect(parsed.stacks[0].report.conflictBranches).toEqual([]);
  });

  test('log --json on a fresh config dir returns no entries', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['log', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ entries: [], otherRepoCount: 0 });
  });

  test('log surfaces a populated operation log entry', async () => {
    const { repo, configDir } = await makeRepo();
    // Same construction as tests/operation-log.test.ts: OperationLog.create + save.
    // setConfigDir here (in-process) so the save lands in the sibling config dir
    // that the spawned CLI below reads via GITQ_CONFIG_DIR.
    setConfigDir(configDir);

    let stack = StackManager.createStack('test-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    const branchSnapshots = { main: 'sha-main', 'feat/a': 'sha-a' };
    const entry = OperationLog.create('sync', stack, branchSnapshots);
    await OperationLog.save(entry);

    const { stdout: jsonOut, exitCode: jsonExit } = await runCli(['log', '--json'], repo.dir, configDir);
    expect(jsonExit).toBe(0);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].operation).toBe('sync');
    expect(Object.keys(parsed.entries[0].branchSnapshots)).toEqual(['main', 'feat/a']);

    const { stdout: humanOut, exitCode: humanExit } = await runCli(['log'], repo.dir, configDir);
    expect(humanExit).toBe(0);
    expect(humanOut).toContain('sync');
  });

  test('track/add/remove/untrack lifecycle', async () => {
    const { repo, configDir } = await makeRepo();
    await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);
    const add = await runCli(['add', 'feature-a', '--parent', 'main'], repo.dir, configDir);
    expect(add.exitCode).toBe(0);
    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(list.stacks[0].nodes.map((n: { branch: string }) => n.branch)).toEqual(['feature-a']);
    await runCli(['remove', 'feature-a'], repo.dir, configDir);
    await runCli(['untrack', 'mystack'], repo.dir, configDir);
    const after = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(after.stacks).toEqual([]);
  });

  test('add on a 2-stack repo without --stack exits 1 and lists stack names', async () => {
    const { repo, configDir } = await makeRepo();
    await runCli(['track', 'stack-one', '--root', 'main'], repo.dir, configDir);
    await runCli(['track', 'stack-two', '--root', 'main'], repo.dir, configDir);
    const { exitCode, stderr } = await runCli(['add', 'feature-a', '--parent', 'main'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('stack-one');
    expect(stderr).toContain('stack-two');
  });

  test('duplicate track exits 1 and leaves the existing stack alone', async () => {
    const { repo, configDir } = await makeRepo();
    await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);
    const { exitCode, stderr } = await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('already exists');
    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(list.stacks).toHaveLength(1);
  });

  test('untrack of an unknown stack name exits 1 and leaves the store unchanged', async () => {
    const { repo, configDir } = await makeRepo();
    await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);
    const { exitCode, stderr } = await runCli(['untrack', 'nope'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('nope');
    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(list.stacks.map((s: { stackName: string }) => s.stackName)).toEqual(['mystack']);
  });

  test('sync -> conflict -> resolve -> continue', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const paused = JSON.parse(sync.stdout);
    expect(paused.state).toBe('paused');
    expect(paused.pauseInfo.conflictTypes[0].type).toBe('UU');

    // The cascade leases a work slot and pauses THERE, not in repo.dir; a
    // repo with no worktree pool gets its slot under the cache root.
    const workDir: string = paused.pauseInfo.worktreePath;
    expect(workDir).toBeTruthy();
    expect(workDir).not.toBe(repo.dir);
    dirsToClean.push(workDir);
    const slotGitDir = gitDirOf(workDir);
    expect(await Bun.file(`${slotGitDir}/gitq-pause.json`).exists()).toBe(true);

    // resolve the standard git way IN THE WORK SLOT, then continue
    await Bun.spawn(['git', 'checkout', '--theirs', '--', 'shared.txt'], { cwd: workDir }).exited;
    await Bun.spawn(['git', 'add', 'shared.txt'], { cwd: workDir }).exited;
    const cont = await runCli(['continue', '--json'], repo.dir, configDir);
    expect(cont.exitCode).toBe(0);
    expect(JSON.parse(cont.stdout).state).toBe('completed');
    expect(await Bun.file(`${slotGitDir}/gitq-pause.json`).exists()).toBe(false);
  });

  test('sync -> conflict -> abort clears pause and leaves no rebase in progress', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const workDir: string = JSON.parse(sync.stdout).pauseInfo.worktreePath;
    dirsToClean.push(workDir);
    const slotGitDir = gitDirOf(workDir);
    expect(await Bun.file(`${slotGitDir}/gitq-pause.json`).exists()).toBe(true);

    const abort = await runCli(['abort', '--json'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
    expect(JSON.parse(abort.stdout)).toEqual({ state: 'aborted' });
    expect(await Bun.file(`${slotGitDir}/gitq-pause.json`).exists()).toBe(false);

    // launch tree was never touched, and the work slot (where the rebase
    // actually ran) is no longer mid-rebase with no conflict markers left.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();
    expect(status.trim()).toBe('');
    const slotStatus = execFileSync('git', ['status', '--porcelain'], { cwd: workDir }).toString();
    expect(slotStatus.trim()).toBe('');
  });

  test('sync refuses when the stack already holds a lease', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const workDir: string = JSON.parse(sync.stdout).pauseInfo.worktreePath;
    dirsToClean.push(workDir);
    const slotGitDir = gitDirOf(workDir);
    const pauseBefore = await Bun.file(`${slotGitDir}/gitq-pause.json`).text();

    // The per-stack guard now answers before withLeasedSlot is ever reached:
    // the stack holds a PARKED lease from the pause above, not a local pause
    // file, so the refusal names the lease rather than "paused".
    const secondSync = await runCli(['sync'], repo.dir, configDir);
    expect(secondSync.exitCode).toBe(1);
    expect(secondSync.stderr).toContain('lease');
    expect(secondSync.stderr).toMatch(/continue|abort/);

    // ...and says what is actually blocking. The conflict list is printed
    // once, when the cascade pauses; without this a later command reports
    // only that a lease exists, and recovering the file list means still
    // having that first output or going into the slot by hand.
    const paused = JSON.parse(sync.stdout).pauseInfo;
    expect(secondSync.stderr).toContain(`paused on ${paused.currentBranch}`);
    for (const file of paused.conflictFiles) expect(secondSync.stderr).toContain(file);

    // pause file untouched by the refused sync
    const pauseAfter = await Bun.file(`${slotGitDir}/gitq-pause.json`).text();
    expect(pauseAfter).toBe(pauseBefore);

    // clean up git state before the sandbox repo is torn down
    const abort = await runCli(['abort'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
  });

  test('continue with no pause file exits 1', async () => {
    const { repo, configDir } = await makeRepo();
    const { exitCode, stderr } = await runCli(['continue'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('nothing to continue');
  });

  test('continue when the paused stack no longer exists exits 1', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);

    // Simulate the paused stack disappearing from the store (e.g. edited out
    // externally). `gitq untrack` can't be used here anymore: like every other
    // state-mutating command it now refuses while a cascade is paused, so we
    // rewrite the store directly to reach continue's "no longer exists" path.
    setConfigDir(configDir);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [] });

    const cont = await runCli(['continue'], repo.dir, configDir);
    expect(cont.exitCode).toBe(1);
    expect(cont.stderr).toContain('no longer exists');

    // clean up git state before the sandbox repo is torn down
    const abort = await runCli(['abort'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
  });

  test('a second conflict on continue rewrites the pause file, then resolves to completion', async () => {
    const { repo, configDir } = await makeDoubleConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const firstPause = JSON.parse(sync.stdout);
    expect(firstPause.state).toBe('paused');
    expect(firstPause.pauseInfo.conflictTypes[0].type).toBe('UU');
    const workDir: string = firstPause.pauseInfo.worktreePath;
    dirsToClean.push(workDir);
    const slotGitDir = gitDirOf(workDir);

    // Resolve by keeping the rebase target's content. During a rebase,
    // `--ours` is the branch being rebased *onto* (not the replayed commit),
    // so this leaves the second commit's patch conflicting again. Resolved
    // in the WORK SLOT, since that's where this cascade's rebase runs.
    await Bun.spawn(['git', 'checkout', '--ours', '--', 'shared.txt'], { cwd: workDir }).exited;
    await Bun.spawn(['git', 'add', 'shared.txt'], { cwd: workDir }).exited;

    const cont1 = await runCli(['continue', '--json'], repo.dir, configDir);
    expect(cont1.exitCode).toBe(2);
    const secondPause = JSON.parse(cont1.stdout);
    expect(secondPause.state).toBe('paused');
    expect(secondPause.pauseInfo.conflictTypes[0].type).toBe('UU');
    // Fresh pause info from the second commit's rebase progress, not a stale
    // copy of the first pause.
    expect(secondPause.pauseInfo.commitIndex).toBe(2);
    expect(secondPause.pauseInfo.commitTotal).toBe(2);

    const pauseFileContents = JSON.parse(await Bun.file(`${slotGitDir}/gitq-pause.json`).text());
    expect(pauseFileContents.pauseInfo.commitIndex).toBe(2);

    // resolve the second conflict the same way and finish
    await Bun.spawn(['git', 'checkout', '--ours', '--', 'shared.txt'], { cwd: workDir }).exited;
    await Bun.spawn(['git', 'add', 'shared.txt'], { cwd: workDir }).exited;

    const cont2 = await runCli(['continue', '--json'], repo.dir, configDir);
    expect(cont2.exitCode).toBe(0);
    expect(JSON.parse(cont2.stdout).state).toBe('completed');
    expect(await Bun.file(`${slotGitDir}/gitq-pause.json`).exists()).toBe(false);
  });

  // ── Surgery commands (Task 14) ──────────────────────────────────────────

  test('absorb --preview names the attributed branch and leaves git status unchanged', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    repo.git('checkout', 'feat/branch-2');
    await writeFile(join(repo.dir, 'file-1-a.txt'), 'branch 1 commit A updated\n', 'utf-8');

    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();

    const { stdout, exitCode } = await runCli(['absorb', '--preview', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.attributed['feat/branch-1']).toContain('file-1-a.txt');

    const statusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();
    expect(statusAfter).toBe(statusBefore);
  });

  test('absorb (no --preview) distributes the change and reports it absorbed', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    repo.git('checkout', 'feat/branch-2');
    await writeFile(join(repo.dir, 'file-1-a.txt'), 'branch 1 commit A updated\n', 'utf-8');

    const { stdout, exitCode } = await runCli(['absorb', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.absorbed).toBe(true);
    expect(parsed.result.attributions.some((a: { branch: string }) => a.branch === 'feat/branch-1')).toBe(true);

    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();
    expect(dirty.trim()).toBe('');
  });

  test('fold lands child commits on parent and removes the node from stacks --json', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);

    const { stdout, exitCode } = await runCli(['fold', 'feat/branch-2', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.foldedBranch).toBe('feat/branch-2');
    expect(parsed.result.intoParent).toBe('feat/branch-1');

    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    const branches = list.stacks[0].nodes.map((n: { branch: string }) => n.branch);
    expect(branches).not.toContain('feat/branch-2');
    expect(branches).toContain('feat/branch-1');

    repo.git('checkout', 'feat/branch-1');
    const log = execFileSync('git', ['log', '--oneline', '-5'], { cwd: repo.dir }).toString();
    expect(log).toContain('feat/branch-2: commit A');
    expect(log).toContain('feat/branch-2: commit B');
  });

  test('split --at tail-splits commits after the given sha into a new branch', async () => {
    const { repo, configDir } = await makeRepo();
    setConfigDir(configDir);
    repo.git('checkout', '-b', 'feat/x');
    const shaA = await commit(repo.dir, repo.git, 'a.txt', 'a\n', 'commit A');
    await commit(repo.dir, repo.git, 'b.txt', 'b\n', 'commit B');

    let stack = StackManager.createStack('split-test', 'main');
    stack = StackManager.addNode(stack, 'feat/x', 'main');
    stack = StackManager.updateNode(stack, 'feat/x', { lastKnownHead: repo.git('rev-parse', 'HEAD') });
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
    repo.git('checkout', 'main');

    const { stdout, exitCode } = await runCli(
      ['split', 'feat/x', '--at', shaA, '--name', 'feat/x-tail', '--json'],
      repo.dir,
      configDir,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.newBranch).toBe('feat/x-tail');
    expect(parsed.result.movedCommits).toHaveLength(1);

    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    const branches = list.stacks[0].nodes.map((n: { branch: string }) => n.branch);
    expect(branches).toContain('feat/x');
    expect(branches).toContain('feat/x-tail');
  });

  test('reparent moves a branch under a new parent', async () => {
    const { repo, configDir } = await makeRepoWithStack(3);

    const { stdout, exitCode } = await runCli(
      ['reparent', 'feat/branch-3', '--onto', 'feat/branch-1', '--json'],
      repo.dir,
      configDir,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.oldParent).toBe('feat/branch-2');
    expect(parsed.result.newParent).toBe('feat/branch-1');

    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    const node = list.stacks[0].nodes.find((n: { branch: string }) => n.branch === 'feat/branch-3');
    expect(node.parent).toBe('feat/branch-1');
  });

  test('rename refuses when a work slot holds the branch, naming the slot', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    // The pre-guard is shared by absorb, rename and reset, and until MAT-23 it
    // could not see a `gitq-N` slot at all: rename moved the ref and left this
    // tree on a branch name that no longer existed.
    const work = addWorkSlot(repo, 'gitq-1', 'feat/branch-2');
    dirsToClean.push(work.root);

    const res = await runCli(['rename', 'feat/branch-2', 'feat/renamed'], repo.dir, configDir);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('is checked out in work slot "gitq-1"');
    expect(res.stderr).toContain(work.path);
    expect(res.stderr).toContain('free that slot');
    // Nothing moved.
    expect(execFileSync('git', ['branch', '--list'], { cwd: repo.dir }).toString()).toContain('feat/branch-2');
  });

  test('rename refuses when a human worktree holds the branch, telling you to work from it', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    const human = await addNamedWorktree(repo, 'dobby', 'feat/branch-2');
    dirsToClean.push(human);

    const res = await runCli(['rename', 'feat/branch-2', 'feat/renamed'], repo.dir, configDir);

    expect(res.exitCode).toBe(1);
    // A human worktree gets different advice from one of gitq's slots: it is a
    // place they can reasonably run the command from.
    expect(res.stderr).toContain(`is checked out in slot "${basename(human)}"`);
    expect(res.stderr).toContain('run this from that worktree');
  });

  test('rename renames the git branch and updates the stack tree', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);

    const { stdout, exitCode } = await runCli(['rename', 'feat/branch-2', 'feat/branch-2-renamed', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);

    const gitBranches = execFileSync('git', ['branch', '--list'], { cwd: repo.dir }).toString();
    expect(gitBranches).not.toContain('feat/branch-2\n');
    expect(gitBranches).toContain('feat/branch-2-renamed');

    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    const branches = list.stacks[0].nodes.map((n: { branch: string }) => n.branch);
    expect(branches).toContain('feat/branch-2-renamed');
    expect(branches).not.toContain('feat/branch-2');
    expect(JSON.parse(stdout).result.updatedStack.nodes.map((n: { branch: string }) => n.branch)).toContain('feat/branch-2-renamed');
  });

  test('reset resets a diverged local branch back to origin', async () => {
    const repo = await createSandboxRepoWithRemote();
    const configDir = `${repo.dir}-config`;
    dirsToClean.push(repo.dir, configDir, repo.remoteDir);
    setConfigDir(configDir);

    repo.git('checkout', '-b', 'feat/y');
    const remoteHead = await commit(repo.dir, repo.git, 'y.txt', 'y\n', 'feat/y: add y.txt');
    repo.git('push', 'origin', 'feat/y');
    repo.git('checkout', 'main');

    let stack = StackManager.createStack('reset-test', 'main');
    stack = StackManager.addNode(stack, 'feat/y', 'main');
    stack = StackManager.updateNode(stack, 'feat/y', { lastKnownHead: remoteHead });
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });

    // Diverge locally: amend feat/y so its local head no longer matches origin.
    repo.git('checkout', 'feat/y');
    await commit(repo.dir, repo.git, 'y2.txt', 'y2\n', 'feat/y: extra local commit');
    repo.git('checkout', 'main');

    const { stdout, exitCode } = await runCli(['reset', 'feat/y', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.result.newHead).toBe(remoteHead);

    const localHead = repo.git('rev-parse', 'feat/y');
    expect(localHead).toBe(remoteHead);
  });

  // ── Forge commands + undo (Task 15) ─────────────────────────────────────

  /**
   * A tracked stack whose origin points at `remoteUrl`, ready to fail publish.
   *
   * The remote never gets contacted: every case below fails during provider or
   * token resolution, all of which happens before the first request. The bare
   * clone still has to exist, since `track` runs against a real repo.
   */
  async function repoWithRemoteUrl(remoteUrl: string): Promise<{ dir: string; configDir: string; home: string }> {
    const repo = await createSandboxRepoWithRemote();
    const configDir = `${repo.dir}-config`;
    // An empty HOME keeps the ~/.mattstack/rt/secrets.json fallback from leaking a real
    // token from the machine running these tests, and keeps ~/.config/gitq's
    // `forges` overrides out of it too.
    const home = await mkdtemp(join(tmpdir(), 'gitq-home-'));
    dirsToClean.push(repo.dir, configDir, repo.remoteDir, home);

    repo.git('remote', 'set-url', 'origin', remoteUrl);
    await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);
    await runCli(['add', 'feat/a', '--parent', 'main'], repo.dir, configDir);

    return { dir: repo.dir, configDir, home };
  }

  test('publish without a GitLab token fails cleanly', async () => {
    const { dir, configDir, home } = await repoWithRemoteUrl('git@gitlab.com:acme/web.git');

    const res = await runCli(['publish', '--json'], dir, configDir, { GITLAB_TOKEN: '', HOME: home });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('no gitlab token for gitlab.com');
    expect(res.stderr).toContain('GITLAB_TOKEN');
  });

  test('publish against a GitHub remote asks for a GitHub token', async () => {
    const { dir, configDir, home } = await repoWithRemoteUrl('git@github.com:acme/web.git');

    // The forge comes from the remote, so a GitLab token in the environment is
    // not the credential this repo needs and is not offered as one.
    const res = await runCli(['publish', '--json'], dir, configDir, {
      GITLAB_TOKEN: 'glpat-should-be-ignored',
      GITHUB_TOKEN: '',
      HOME: home,
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('no github token for github.com');
    expect(res.stderr).toContain('GITHUB_TOKEN');
  });

  test('publish against an unrecognised host says so instead of guessing', async () => {
    const { dir, configDir, home } = await repoWithRemoteUrl('git@git.acme.com:acme/web.git');

    const res = await runCli(['publish', '--json'], dir, configDir, { GITLAB_TOKEN: 'glpat-x', HOME: home });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('cannot tell which forge "git.acme.com" is');
    expect(res.stderr).toContain('forges');
  });

  test('publish against a hostless remote says the remote names no forge', async () => {
    const { dir, configDir, home } = await repoWithRemoteUrl('/srv/git/acme/web.git');

    const res = await runCli(['publish', '--json'], dir, configDir, { GITLAB_TOKEN: 'glpat-x', HOME: home });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('no forge host in remote');
  });

  test('publish rejects malformed --mr-meta', async () => {
    const repo = await createSandboxRepoWithRemote();
    const configDir = `${repo.dir}-config`;
    dirsToClean.push(repo.dir, configDir, repo.remoteDir);

    // No stack tracked here: --mr-meta is validated before store/stack
    // resolution, so this fails on the malformed meta regardless.
    const metaPath = `${repo.dir}/meta.json`;
    await Bun.write(metaPath, '{"branch": "not an object"}');
    const res = await runCli(['publish', '--mr-meta', metaPath, '--json'], repo.dir, configDir);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('mr-meta');
  });

  test('undo restores a branch snapshot recorded in the operation log', async () => {
    const { repo, configDir } = await makeRepo();
    setConfigDir(configDir);

    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 1);
    const branchSnapshots = { main: shas.get('main')!, 'feat/branch-1': shas.get('feat/branch-1')! };
    const entry = OperationLog.create('sync', stack, branchSnapshots);
    await OperationLog.save(entry);

    const { stdout, exitCode } = await runCli(['undo', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.restoredBranches.sort()).toEqual(['feat/branch-1', 'main']);
  });

  test('undo drops a branch git no longer has instead of re-tracking it', async () => {
    const { repo, configDir } = await makeRepo();
    setConfigDir(configDir);

    // main -> branch-1 -> branch-2 -> branch-3
    const { stack, shas } = await buildLinearStack(repo.dir, repo.git, 3);
    await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });

    const branchSnapshots: Record<string, string> = {};
    for (const node of stack.nodes) branchSnapshots[node.branch] = shas.get(node.branch)!;
    const entry = OperationLog.create('cascade-rebase', stack, branchSnapshots);
    await OperationLog.save(entry);

    // Simulate the branch being deleted after the snapshotted operation —
    // undo() will skip it but still reports success:true overall.
    repo.git('checkout', 'main');
    repo.git('branch', '-D', 'feat/branch-2');

    const { stdout, exitCode } = await runCli(['undo', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.skippedBranches).toEqual(['feat/branch-2']);

    const stacksOut = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    const nodes = stacksOut.stacks[0].nodes as { branch: string; parent: string }[];
    const branches = nodes.map((n) => n.branch);
    expect(branches).not.toContain('feat/branch-2');
    expect(branches.sort()).toEqual(['feat/branch-1', 'feat/branch-3']);

    // branch-3 was reparented onto branch-2's parent (branch-1) instead of
    // being left pointing at a branch git no longer has.
    const branch3 = nodes.find((n) => n.branch === 'feat/branch-3');
    expect(branch3?.parent).toBe('feat/branch-1');
  });

  // ── Final-review fixes (Plan 1) ─────────────────────────────────────────

  // Finding 1: the recorder actually writes the operation log.
  test('fold records an operation-log entry visible in gitq log', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);

    const fold = await runCli(['fold', 'feat/branch-2', '--json'], repo.dir, configDir);
    expect(fold.exitCode).toBe(0);

    const log = JSON.parse((await runCli(['log', '--json'], repo.dir, configDir)).stdout);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].operation).toBe('fold');
    expect(log.entries[0].repoPath).toBe(repo.dir);

    const human = await runCli(['log'], repo.dir, configDir);
    expect(human.stdout).toContain('fold');
  });

  // Finding 1: recorder + undo work end-to-end on a reversible op (reparent).
  test('undo restores branch heads after a recorded reparent', async () => {
    const { repo, configDir } = await makeRepoWithStack(3);
    const b3Before = execFileSync('git', ['rev-parse', 'feat/branch-3'], { cwd: repo.dir }).toString().trim();

    // Move branch-2 onto main; its descendant branch-3 cascades to a new head.
    const reparent = await runCli(['reparent', 'feat/branch-2', '--onto', 'main', '--json'], repo.dir, configDir);
    expect(reparent.exitCode).toBe(0);
    const b3After = execFileSync('git', ['rev-parse', 'feat/branch-3'], { cwd: repo.dir }).toString().trim();
    expect(b3After).not.toBe(b3Before);

    const log = JSON.parse((await runCli(['log', '--json'], repo.dir, configDir)).stdout);
    expect(log.entries.some((e: { operation: string }) => e.operation === 'reparent')).toBe(true);

    const undo = await runCli(['undo', '--json'], repo.dir, configDir);
    expect(undo.exitCode).toBe(0);
    expect(JSON.parse(undo.stdout).success).toBe(true);

    const b3Restored = execFileSync('git', ['rev-parse', 'feat/branch-3'], { cwd: repo.dir }).toString().trim();
    expect(b3Restored).toBe(b3Before);
  });

  // Finding 1: the log is scoped per repo (cross-repo footgun).
  test('operation log is scoped per repo: a second repo neither sees nor undoes it', async () => {
    // Two repos sharing ONE config dir (hence one global operation-log file).
    const repoA = await createSandboxRepo();
    const repoB = await createSandboxRepo();
    const configDir = `${repoA.dir}-shared-config`;
    dirsToClean.push(repoA.dir, repoB.dir, configDir);
    setConfigDir(configDir);

    const { stack } = await buildLinearStack(repoA.dir, repoA.git, 2);
    await saveStore(repoA.dir, { repoPath: repoA.dir, remoteUrl: '', stacks: [stack] });

    const fold = await runCli(['fold', 'feat/branch-2', '--json'], repoA.dir, configDir);
    expect(fold.exitCode).toBe(0);

    // A sees its own entry.
    const logA = JSON.parse((await runCli(['log', '--json'], repoA.dir, configDir)).stdout);
    expect(logA.entries).toHaveLength(1);

    // B (same config dir) sees none of A's entries, but counts them.
    const logB = JSON.parse((await runCli(['log', '--json'], repoB.dir, configDir)).stdout);
    expect(logB.entries).toHaveLength(0);
    expect(logB.otherRepoCount).toBe(1);

    // B cannot undo A's operation.
    const undoB = await runCli(['undo'], repoB.dir, configDir);
    expect(undoB.exitCode).toBe(1);
    expect(undoB.stderr).toContain('no operations for this repo');
  });

  // Finding 2: absorb whose descendant restack conflicts must not false-succeed.
  // Reached through --at: blame attributes F.txt to b2's revert commit, the last
  // one to touch that line, so plain attribution sends this to b2 and replays
  // clean. Forcing it onto b1 is what still lands on the conflicting cascade.
  test('absorb aborts and exits 1 when the restack conflicts (no mid-rebase left)', async () => {
    const { repo, configDir } = await makeAbsorbCascadeConflictRepo();

    const res = await runCli(['absorb', '--at', 'b1'], repo.dir, configDir);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('b2');
    expect(res.stderr).toContain('gitq sync');

    // git is NOT left mid-rebase and the working tree is clean.
    expect(rebaseInProgress(repo.dir)).toBe(false);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();
    expect(status.trim()).toBe('');

    // no phantom operation-log entry for the failed absorb.
    const log = JSON.parse((await runCli(['log', '--json'], repo.dir, configDir)).stdout);
    expect(log.entries).toHaveLength(0);
  });

  // Finding 3: every state-mutating command refuses while a cascade is paused.
  test('rename refuses while a cascade is paused, leaving the pause file untouched', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const workDir: string = JSON.parse(sync.stdout).pauseInfo.worktreePath;
    dirsToClean.push(workDir);
    const slotGitDir = gitDirOf(workDir);
    const pauseBefore = await Bun.file(`${slotGitDir}/gitq-pause.json`).text();

    // rename now refuses via the per-stack lease guard (the parked lease
    // sync left behind), not the legacy local pause-file check.
    const rename = await runCli(['rename', 'feat/conflict', 'feat/renamed'], repo.dir, configDir);
    expect(rename.exitCode).toBe(1);
    expect(rename.stderr).toContain('lease');
    expect(rename.stderr).toMatch(/continue|abort/);

    const pauseAfter = await Bun.file(`${slotGitDir}/gitq-pause.json`).text();
    expect(pauseAfter).toBe(pauseBefore);

    // clean up git state before teardown
    const abort = await runCli(['abort'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
  });

  test('a dead lease holder does not deadlock the stack (MAT-78)', async () => {
    const { repo, configDir, stack } = await makeRepoWithStack(2);
    const commonDir = await resolveRepoIdentity(repo.dir);

    // A pid that is certainly not running: spawn something trivial and wait for
    // it to exit, so the number was genuinely allocated and is now free. Hard
    // -coding a large pid would pass by luck and fail on a busy machine.
    const corpse = Bun.spawn(['true']);
    const deadPid = corpse.pid;
    await corpse.exited;

    await mkdir(join(commonDir, 'gitq'), { recursive: true });
    await writeFile(
      join(commonDir, 'gitq', 'leases.json'),
      JSON.stringify({
        leases: [
          {
            slotPath: join(repo.dir, 'gitq-1'),
            stackId: stack.id,
            action: 'sync',
            pid: deadPid,
            acquiredAt: Date.now(),
            state: 'running',
          },
        ],
      }),
    );

    // The deadlock as reported: every mutating command refused on this lease,
    // while `gitq continue` and `gitq abort` -- the two remedies the refusal
    // message names -- look only at parked leases and answered "nothing to
    // continue". The documented way out was editing leases.json by hand.
    const rename = await runCli(['rename', stack.nodes[0]!.branch, 'feat/renamed'], repo.dir, configDir);
    expect(rename.exitCode).toBe(0);

    // Invisible to readers, but still on disk: a read holds no write lock, so
    // the row is cleared by the next acquireLease rather than by this command.
    expect(await listLeases(commonDir)).toEqual([]);
    const onDisk = JSON.parse(await Bun.file(join(commonDir, 'gitq', 'leases.json')).text());
    expect(onDisk.leases).toHaveLength(1);
  });

  test('add refuses while a cascade is paused, leaving the store unchanged', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const workDir: string = JSON.parse(sync.stdout).pauseInfo.worktreePath;
    dirsToClean.push(workDir);

    const before = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);

    // add now refuses via the per-stack lease guard, not the legacy local
    // pause-file check.
    const add = await runCli(['add', 'x', '--parent', 'main'], repo.dir, configDir);
    expect(add.exitCode).toBe(1);
    expect(add.stderr).toContain('lease');
    expect(add.stderr).toMatch(/continue|abort/);

    const after = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(after).toEqual(before);

    // clean up git state before teardown
    const abort = await runCli(['abort'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
  });

  // Finding 4: reparent's cascade pause carries the same rich pauseInfo as sync.
  test('reparent cascade conflict pauses with conflictTypes populated', async () => {
    const { repo, configDir } = await makeReparentCascadeConflictRepo();

    const res = await runCli(['reparent', 'b1', '--onto', 'sib', '--json'], repo.dir, configDir);
    expect(res.exitCode).toBe(2);
    const paused = JSON.parse(res.stdout);
    expect(paused.state).toBe('paused');
    expect(paused.pauseInfo.currentBranch).toBe('b2');
    expect(paused.pauseInfo.phase).toBe('cascade');
    expect(paused.pauseInfo.conflictTypes.length).toBeGreaterThan(0);
    expect(paused.pauseInfo.conflictTypes[0].type).toBe('UU');

    // reparent's descendant cascade runs detached in the leased work slot
    // (same contract as sync), so pauseInfo carries worktreePath naming that
    // slot, not treePath naming the launch tree.
    expect(paused.pauseInfo.worktreePath).toBeDefined();
    expect(paused.pauseInfo.worktreePath).toMatch(/gitq-\d+$/);
    expect(paused.pauseInfo.treePath).toBeUndefined();

    // The pause FILE still lives in the leased work slot's git dir
    // (finishCascade's four-arg form), found via the lease.
    setConfigDir(configDir);
    const commonDir = await resolveRepoIdentity(repo.dir);
    const [lease] = await listLeases(commonDir);
    expect(lease).toBeTruthy();
    dirsToClean.push(lease!.slotPath);
    const slotGitDir = gitDirOf(lease!.slotPath);
    expect(await Bun.file(`${slotGitDir}/gitq-pause.json`).exists()).toBe(true);

    // Abort FROM A SIBLING WORKTREE, not the launch tree and not the leased
    // slot: the cascade pauses and rebases inside the leased gitq-N work
    // slot, not in repo.dir or the sibling, so abort has to resolve the
    // parked lease from whatever cwd it's invoked from and clean up the
    // rebase state in that slot.
    const sibling = await addNamedWorktree(repo, 'sibling');
    dirsToClean.push(sibling);
    const siblingHeadBefore = execFileSync('git', ['-C', sibling, 'rev-parse', 'HEAD'], { stdio: 'pipe' })
      .toString()
      .trim();

    const abort = await runCli(['abort', '--stack', 'reparent-cascade'], sibling, configDir);
    expect(abort.exitCode).toBe(0);

    // The leased slot (where the cascade actually paused) is no longer
    // mid-rebase, not the launch tree.
    expect(
      existsSync(join(slotGitDir, 'rebase-merge')) || existsSync(join(slotGitDir, 'rebase-apply')),
    ).toBe(false);

    // The sibling is untouched.
    const siblingHeadAfter = execFileSync('git', ['-C', sibling, 'rev-parse', 'HEAD'], { stdio: 'pipe' })
      .toString()
      .trim();
    expect(siblingHeadAfter).toBe(siblingHeadBefore);

    // The lease is released: a follow-up mutation on the stack succeeds and
    // does not mention a lease.
    const after = await runCli(['untrack', 'reparent-cascade'], repo.dir, configDir);
    expect(after.exitCode).toBe(0);
    expect(after.stderr).not.toContain('lease');
  });

  // ── Help (MAT-85) ───────────────────────────────────────────────────────

  // The bug as reported: `--help` was parsed as noise and the command ran. On a
  // dirty worktree that meant `absorb --help` amended a commit.
  test('absorb --help prints usage and absorbs nothing', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    repo.git('checkout', 'feat/branch-2');
    await writeFile(join(repo.dir, 'file-1-a.txt'), 'branch 1 commit A updated\n', 'utf-8');

    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();
    const headBefore = execFileSync('git', ['rev-parse', 'feat/branch-1'], { cwd: repo.dir }).toString();
    const stacksBefore = (await runCli(['stacks', '--json'], repo.dir, configDir)).stdout;

    const { stdout, exitCode } = await runCli(['absorb', '--help'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('usage: gitq absorb');
    expect(stdout).toContain('--preview');

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString()).toBe(statusBefore);
    expect(execFileSync('git', ['rev-parse', 'feat/branch-1'], { cwd: repo.dir }).toString()).toBe(headBefore);
    expect((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout).toBe(stacksBefore);
  });

  test('gitq --help lists every command and exits 0', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['--help'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const missing = Object.keys(COMMANDS).filter((name) => !stdout.includes(name));
    expect(missing).toEqual([]);
  });

  test('-h is treated the same as --help', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['import', '-h'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('usage: gitq import');
  });

  // Help answers before context resolution, so it needs no repo, no store and
  // no lease. Run from a directory that is not a git worktree at all.
  test('--help works outside a git repo', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gitq-nonrepo-'));
    dirsToClean.push(outside);

    const { stdout, exitCode } = await runCli(['sync', '--help'], outside, outside);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('usage: gitq sync');
  });

  // Finding 5: import refuses to clobber a non-empty store without --replace,
  // and the refusal is reached before the token check (so it works offline).
  test('import refuses to overwrite a tracked store without --replace (offline)', async () => {
    const repo = await createSandboxRepoWithRemote();
    const configDir = `${repo.dir}-config`;
    const fakeHome = await mkdtemp(join(tmpdir(), 'gitq-home-'));
    dirsToClean.push(repo.dir, configDir, repo.remoteDir, fakeHome);

    // Seed a store with a stack.
    await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);

    // Blank the token + point HOME at an empty dir: if the store check ran
    // AFTER the token check this would fail with 'no gitlab token' instead.
    const res = await runCli(['import'], repo.dir, configDir, { GITLAB_TOKEN: '', HOME: fakeHome });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('--replace');
    expect(res.stderr).not.toContain('token');
  });
});
