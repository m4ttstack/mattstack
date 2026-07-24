import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  createSandboxRepo,
  createSandboxRepoWithRemote,
  cleanupRepo,
  buildLinearStack,
  commit,
  type SandboxRepoWithRemote,
} from './helpers.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore } from '../../src/core/persistence.ts';
import { OperationLog } from '../../src/core/operation-log.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import type { Stack } from '../../src/core/types.ts';

const BIN = join(import.meta.dir, '../../bin/gitq');

export async function runCli(args: string[], cwd: string, configDir: string) {
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

describe('gitq CLI', () => {
  test('stacks --json on a repo with no stacks', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['stacks', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
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
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
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
    expect(JSON.parse(stdout)).toEqual({ entries: [] });
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

    // pause file exists in the git dir (sandbox repos are plain, so .git is a directory)
    const gitDir = `${repo.dir}/.git`;
    expect(await Bun.file(`${gitDir}/gitq-pause.json`).exists()).toBe(true);

    // resolve the standard git way, then continue
    await Bun.spawn(['git', 'checkout', '--theirs', '--', 'shared.txt'], { cwd: repo.dir }).exited;
    await Bun.spawn(['git', 'add', 'shared.txt'], { cwd: repo.dir }).exited;
    const cont = await runCli(['continue', '--json'], repo.dir, configDir);
    expect(cont.exitCode).toBe(0);
    expect(JSON.parse(cont.stdout).state).toBe('completed');
    expect(await Bun.file(`${gitDir}/gitq-pause.json`).exists()).toBe(false);
  });

  test('sync -> conflict -> abort clears pause and leaves no rebase in progress', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);

    const gitDir = `${repo.dir}/.git`;
    expect(await Bun.file(`${gitDir}/gitq-pause.json`).exists()).toBe(true);

    const abort = await runCli(['abort', '--json'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
    expect(JSON.parse(abort.stdout)).toEqual({ state: 'aborted' });
    expect(await Bun.file(`${gitDir}/gitq-pause.json`).exists()).toBe(false);

    // no rebase in progress and no conflict markers left in the working tree
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir }).toString();
    expect(status.trim()).toBe('');
  });

  test('sync refuses when a pause file already exists', async () => {
    const { repo, configDir } = await makeConflictedStack();

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);

    const gitDir = `${repo.dir}/.git`;
    const pauseBefore = await Bun.file(`${gitDir}/gitq-pause.json`).text();

    const secondSync = await runCli(['sync'], repo.dir, configDir);
    expect(secondSync.exitCode).toBe(1);
    expect(secondSync.stderr).toContain('paused');

    // pause file untouched by the refused sync
    const pauseAfter = await Bun.file(`${gitDir}/gitq-pause.json`).text();
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

    const untrack = await runCli(['untrack', 'conflict-stack'], repo.dir, configDir);
    expect(untrack.exitCode).toBe(0);

    const cont = await runCli(['continue'], repo.dir, configDir);
    expect(cont.exitCode).toBe(1);
    expect(cont.stderr).toContain('no longer exists');

    // clean up git state before the sandbox repo is torn down
    const abort = await runCli(['abort'], repo.dir, configDir);
    expect(abort.exitCode).toBe(0);
  });

  test('a second conflict on continue rewrites the pause file, then resolves to completion', async () => {
    const { repo, configDir } = await makeDoubleConflictedStack();
    const gitDir = `${repo.dir}/.git`;

    const sync = await runCli(['sync', '--json'], repo.dir, configDir);
    expect(sync.exitCode).toBe(2);
    const firstPause = JSON.parse(sync.stdout);
    expect(firstPause.state).toBe('paused');
    expect(firstPause.pauseInfo.conflictTypes[0].type).toBe('UU');

    // Resolve by keeping the rebase target's content. During a rebase,
    // `--ours` is the branch being rebased *onto* (not the replayed commit),
    // so this leaves the second commit's patch conflicting again.
    await Bun.spawn(['git', 'checkout', '--ours', '--', 'shared.txt'], { cwd: repo.dir }).exited;
    await Bun.spawn(['git', 'add', 'shared.txt'], { cwd: repo.dir }).exited;

    const cont1 = await runCli(['continue', '--json'], repo.dir, configDir);
    expect(cont1.exitCode).toBe(2);
    const secondPause = JSON.parse(cont1.stdout);
    expect(secondPause.state).toBe('paused');
    expect(secondPause.pauseInfo.conflictTypes[0].type).toBe('UU');
    // Fresh pause info from the second commit's rebase progress, not a stale
    // copy of the first pause.
    expect(secondPause.pauseInfo.commitIndex).toBe(2);
    expect(secondPause.pauseInfo.commitTotal).toBe(2);

    const pauseFileContents = JSON.parse(await Bun.file(`${gitDir}/gitq-pause.json`).text());
    expect(pauseFileContents.pauseInfo.commitIndex).toBe(2);

    // resolve the second conflict the same way and finish
    await Bun.spawn(['git', 'checkout', '--ours', '--', 'shared.txt'], { cwd: repo.dir }).exited;
    await Bun.spawn(['git', 'add', 'shared.txt'], { cwd: repo.dir }).exited;

    const cont2 = await runCli(['continue', '--json'], repo.dir, configDir);
    expect(cont2.exitCode).toBe(0);
    expect(JSON.parse(cont2.stdout).state).toBe('completed');
    expect(await Bun.file(`${gitDir}/gitq-pause.json`).exists()).toBe(false);
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
});
