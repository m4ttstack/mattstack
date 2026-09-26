import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { StackManager } from '../../src/core/stack-manager.ts';
import type { Stack } from '../../src/core/types.ts';

/**
 * A bound git helper that runs git commands in a specific directory.
 * Returns trimmed stdout.
 */
export type GitHelper = (...args: string[]) => string;

export interface SandboxRepo {
  dir: string;
  git: GitHelper;
}

/** Shape descriptor for building tree stacks. */
export interface TreeBranch {
  name: string;
  /** Number of commits to create on this branch. */
  commits: number;
  children?: TreeBranch[];
}

export interface SandboxRepoWithRemote extends SandboxRepo {
  remoteDir: string;
}

/** Create a sandboxed git repo in a temp directory. */
export async function createSandboxRepo(): Promise<SandboxRepo> {
  const rawDir = await mkdtemp(join(tmpdir(), 'gitq-test-'));
  const dir = realpathSync(rawDir);
  const git: GitHelper = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();

  git('init');
  git('config', 'user.email', 'test@gitq.dev');
  git('config', 'user.name', 'GitQ Test');

  // Initial commit on main so the branch exists
  await writeFile(join(dir, 'README.md'), '# Test Repo\n', 'utf-8');
  git('add', '.');
  git('commit', '-m', 'initial commit');

  return { dir, git };
}

/**
 * Create a sandboxed git repo with a local bare remote.
 * The repo has `origin` set to a bare clone, enabling real push/fetch operations.
 */
export async function createSandboxRepoWithRemote(): Promise<SandboxRepoWithRemote> {
  const repo = await createSandboxRepo();

  // Create a bare clone to act as the remote. realpath the temp dir so path
  // equality holds on macOS (mkdtemp returns /var/..., git resolves to /private/var/...).
  const rawRemoteDir = await mkdtemp(join(tmpdir(), 'gitq-remote-'));
  const remoteDir = realpathSync(rawRemoteDir);
  execFileSync('git', ['clone', '--bare', repo.dir, remoteDir], { stdio: 'pipe' });

  // Point the working repo's origin at the bare repo
  repo.git('remote', 'add', 'origin', remoteDir);

  return { ...repo, remoteDir };
}

/** Remove a sandboxed repo (and its remote if present). */
export async function cleanupRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Add a named worktree slot as a sibling of the repo dir (pool convention).
    Returns the slot's realpath. Detached at HEAD unless a branch is given. */
export async function addNamedWorktree(repo: SandboxRepo, name: string, branch?: string): Promise<string> {
  const parent = join(repo.dir, '..');
  const path = join(parent, `${basename(repo.dir)}-pool-${name}`);
  const args = branch
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '--detach', path, 'HEAD'];
  execFileSync('git', args, { cwd: repo.dir, stdio: 'pipe' });
  return realpathSync(path);
}

/**
 * Add a real `gitq-N` work slot holding `branch`, the state a human produces by
 * running `git checkout` inside one of gitq's pool slots. gitq itself always
 * leaves them detached, so this is the only way to reach it.
 *
 * Returns `{ path, root }`; `root` is what to clean up, since the slot lives
 * inside a directory of its own.
 */
export function addWorkSlot(repo: SandboxRepo, name: string, branch: string): { path: string; root: string } {
  const root = `${repo.dir}-slots`;
  repo.git('worktree', 'add', join(root, name), branch);
  return { path: realpathSync(join(root, name)), root };
}

/** Trimmed `git` bound to an arbitrary directory, for worktrees with no helper of their own. */
export function gitIn(dir: string): GitHelper {
  return (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
}

/** Write a file, stage, and commit. Returns the new commit SHA. */
export async function commit(
  dir: string,
  git: GitHelper,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(join(dir, filename), content, 'utf-8');
  git('add', filename);
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}

/**
 * Build a linear stack with real branches and commits.
 *
 * Creates: main -> branch-1 -> branch-2 -> ... -> branch-{depth}
 * Each branch gets 2 commits with unique files.
 *
 * Returns the Stack object (with lastKnownHead set) and a map of branch -> HEAD SHA.
 */
export async function buildLinearStack(
  dir: string,
  git: GitHelper,
  depth: number,
): Promise<{ stack: Stack; shas: Map<string, string> }> {
  const shas = new Map<string, string>();
  let stack = StackManager.createStack('test-stack', 'main');

  shas.set('main', git('rev-parse', 'HEAD'));

  let parentBranch = 'main';
  for (let i = 1; i <= depth; i++) {
    const branchName = `feat/branch-${i}`;
    git('checkout', '-b', branchName);

    await commit(dir, git, `file-${i}-a.txt`, `branch ${i} commit A\n`, `${branchName}: commit A`);
    const head = await commit(dir, git, `file-${i}-b.txt`, `branch ${i} commit B\n`, `${branchName}: commit B`);

    shas.set(branchName, head);
    stack = StackManager.addNode(stack, branchName, parentBranch);
    stack = StackManager.updateNode(stack, branchName, { lastKnownHead: head });

    parentBranch = branchName;
  }

  git('checkout', 'main');
  return { stack, shas };
}

/**
 * Build a tree-shaped stack from a shape descriptor.
 *
 * Example shape:
 *   { name: 'feat/a', commits: 2, children: [
 *     { name: 'feat/b', commits: 1 },
 *     { name: 'feat/c', commits: 2 },
 *   ]}
 *
 * All branches fork from their parent. Returns Stack + SHA map.
 */
export async function buildTreeStack(
  dir: string,
  git: GitHelper,
  branches: TreeBranch[],
): Promise<{ stack: Stack; shas: Map<string, string> }> {
  const shas = new Map<string, string>();
  let stack = StackManager.createStack('test-stack', 'main');

  shas.set('main', git('rev-parse', 'HEAD'));

  async function buildBranch(branch: TreeBranch, parent: string): Promise<void> {
    git('checkout', parent);
    git('checkout', '-b', branch.name);

    let head = '';
    for (let i = 1; i <= branch.commits; i++) {
      const filename = `${branch.name.replace(/\//g, '-')}-${i}.txt`;
      head = await commit(dir, git, filename, `${branch.name} commit ${i}\n`, `${branch.name}: commit ${i}`);
    }

    shas.set(branch.name, head);
    stack = StackManager.addNode(stack, branch.name, parent);
    stack = StackManager.updateNode(stack, branch.name, { lastKnownHead: head });

    if (branch.children) {
      for (const child of branch.children) {
        await buildBranch(child, branch.name);
      }
    }
  }

  for (const branch of branches) {
    await buildBranch(branch, 'main');
  }

  git('checkout', 'main');
  return { stack, shas };
}

/**
 * Run the real CLI binary in `cwd` against an isolated config dir, and return
 * what a user would see. Lives here rather than in a test file so a suite can
 * use it without importing (and re-running) another suite.
 */
export async function runCli(
  args: string[],
  cwd: string,
  configDir: string,
  envOverride: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', join(import.meta.dir, '../../bin/gitq'), ...args], {
    cwd,
    env: { ...process.env, GITQ_CONFIG_DIR: configDir, ...envOverride },
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
