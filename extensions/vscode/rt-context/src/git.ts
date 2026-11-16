import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BranchInfo, WorktreeEntry, GitExtensionExports, GitAPI, GitRepository } from './types';
import { parseWorktreePorcelain } from './worktreeParse';
import { STASH_LIST_FORMAT, desktopStashMessage, findDesktopStashIn, stashRefFor, type DesktopStashEntry } from './stashParse';
import { repoIdentityFromRemote } from './repoIdentity';

const execFileAsync = promisify(execFile);

// ── Worktree helpers ──

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const currentFolder = await getRepoRootName();

  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd });
    return parseWorktreePorcelain(stdout, currentFolder);
  } catch {
    return [];
  }
}

// ── Branch listing ──

/**
 * List all local + remote branches, sorted by committer date (most recent first).
 * Remote branches that have a matching local branch are deduplicated.
 */
export async function listAllBranches(cwd: string): Promise<BranchInfo[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['branch', '-a', '--sort=-committerdate', '--format=%(refname:short)\t%(committerdate:unix)'],
      { cwd },
    );
    const seen = new Map<string, number>(); // displayName -> index in results
    const results: BranchInfo[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [ref, epochStr] = trimmed.split('\t');
      if (!ref) continue;
      const commitEpoch = parseInt(epochStr ?? '0', 10) || 0;

      // Skip HEAD pointer entries — with --format, origin/HEAD appears as
      // "origin/HEAD" or just "origin" depending on git version (no "->" syntax)
      if (ref.includes('->') || ref === 'origin' || ref.endsWith('/HEAD')) continue;

      // Determine if local or remote
      const isRemote = ref.startsWith('origin/');
      const displayName = isRemote ? ref.replace(/^origin\//, '') : ref;

      // Extra safety: skip if display name resolves to HEAD
      if (displayName === 'HEAD') continue;

      const existingIdx = seen.get(displayName);
      if (existingIdx !== undefined) {
        // Local always wins over remote — if we already have a remote entry
        // and now see the local one, replace it in-place to keep sort position
        if (!isRemote && !results[existingIdx]!.isLocal) {
          results[existingIdx] = { name: displayName, ref, isLocal: true, commitEpoch };
        }
        continue;
      }
      seen.set(displayName, results.length);

      results.push({ name: displayName, ref, isLocal: !isRemote, commitEpoch });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Get the set of branch names checked out in any worktree (including bare entries).
 * This is used to exclude branches that can't be switched to from another worktree.
 */
export async function getWorktreeBranches(cwd: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd });
    const branches = new Set<string>();
    for (const line of stdout.split('\n')) {
      // Lines look like: "branch refs/heads/feature-foo"
      if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length).trim();
        const name = ref.replace(/^refs\/heads\//, '');
        branches.add(name);
      }
    }
    return branches;
  } catch {
    return new Set();
  }
}

export async function listLocalBranches(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd });
    return stdout.split('\n').map((b) => b.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Stash helpers (GitHub Desktop-compatible) ──

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Stash uncommitted changes with a GitHub Desktop-compatible marker.
 * Uses the `!!GitHub_Desktop<branch>` format so stashes appear in
 * GitHub Desktop's "Stashed Changes" panel.
 */
export async function stashChanges(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['stash', 'push', '-u', '-m', desktopStashMessage(branch)], { cwd });
}

async function stashList(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['stash', 'list', STASH_LIST_FORMAT], { cwd });
    return stdout;
  } catch {
    return '';
  }
}

/** The newest GitHub Desktop-tagged stash for a branch, or null. */
export async function findDesktopStash(cwd: string, branch: string): Promise<DesktopStashEntry | null> {
  return findDesktopStashIn(await stashList(cwd), branch);
}

/**
 * `git stash drop` takes only a `stash@{n}`, so the index is looked up just
 * before the drop. Another worktree pushing a stash in the milliseconds
 * between the two can still shift it; that window is narrowed, not closed.
 */
async function dropBySha(cwd: string, stash: DesktopStashEntry): Promise<void> {
  const ref = stashRefFor(await stashList(cwd), stash.sha);
  if (!ref) throw new Error(`the stash for '${stash.branchName}' is no longer there`);
  await execFileAsync('git', ['stash', 'drop', ref], { cwd });
}

/** Applies by sha, so only this stash's changes can land here; a conflict leaves the stash in place, as `pop` would. */
export async function popStash(cwd: string, stash: DesktopStashEntry): Promise<void> {
  await execFileAsync('git', ['stash', 'apply', stash.sha], { cwd });
  try {
    await dropBySha(cwd, stash);
  } catch {
    // The changes are applied; a stash something else already dropped needs nothing more.
  }
}

export async function dropStash(cwd: string, stash: DesktopStashEntry): Promise<void> {
  await dropBySha(cwd, stash);
}

/** Detect whether origin/main or origin/master exists. Returns the ref or null. */
export async function getRemoteDefaultBranch(cwd: string): Promise<string | null> {
  for (const candidate of ['origin/main', 'origin/master']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', candidate], { cwd });
      return candidate;
    } catch {
      // doesn't exist, try next
    }
  }
  return null;
}

// ── Checkout ──

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['checkout', branch], { cwd });
}

export async function createBranch(cwd: string, branch: string, startPoint?: string): Promise<void> {
  const args = ['checkout', '-b', branch];
  if (startPoint) args.push(startPoint);
  await execFileAsync('git', args, { cwd });
}

export async function fetchRemoteBranch(cwd: string, remote: string, branch: string): Promise<void> {
  await execFileAsync('git', ['fetch', remote, branch], { cwd });
}

// ── VS Code Git API helpers ──

export function getGitApi(): GitAPI | null {
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext?.isActive) return null;
  return ext.exports.getAPI(1);
}

export async function findWorkspaceRepo(gitApi: GitAPI): Promise<GitRepository | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;

  const workspacePath = folders[0]!.uri.fsPath;

  // Resolve the actual git root — the workspace may be opened to a subfolder
  let repoRoot = workspacePath;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workspacePath });
    const resolved = stdout.trim();
    if (resolved) repoRoot = resolved;
  } catch {
    // git not available — fall back to raw workspace path
  }

  return gitApi.repositories.find(
    (repo) => repo.rootUri.fsPath === repoRoot,
  );
}

export function getRemoteUrl(repo: GitRepository): string | null {
  const remote = repo.state.remotes.find((r) => r.name === 'origin');
  return remote?.fetchUrl ?? remote?.pushUrl ?? null;
}

export function getWorktreeName(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return 'unknown';
  return path.basename(folders[0]!.uri.fsPath);
}

/**
 * Get the git directory path (e.g. `/path/.git` or `/path/.git/worktrees/branch`).
 * Handles linked worktrees where `.git` is a file.
 * Returns null if the cwd is not inside a git repo.
 */
/**
 * Read the current branch name directly from the .git/HEAD file.
 * Synchronous and instant — no subprocess. Returns null for detached HEAD.
 * Use this instead of repo.state.HEAD?.name to avoid VS Code git API lag
 * after external checkouts.
 */
export function readBranchFromHead(gitDir: string): string | null {
  try {
    const { readFileSync } = require('fs') as typeof import('fs');
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null;
  } catch {
    return null;
  }
}

export async function getGitDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
    const gitDir = stdout.trim();
    if (!gitDir) return null;
    // --git-dir may return a relative path; resolve it against cwd
    return path.resolve(cwd, gitDir);
  } catch {
    return null;
  }
}

/**
 * Get the repo root folder name by running `git rev-parse --show-toplevel`.
 * Falls back to the workspace folder name if git isn't available.
 *
 * This is important when the workspace is opened to a subfolder — the
 * status bar should still show the worktree/repo root name.
 */
export async function getRepoRootName(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return 'unknown';

  const cwd = folders[0]!.uri.fsPath;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    const toplevel = stdout.trim();
    if (toplevel) return path.basename(toplevel);
  } catch {
    // git not available — fall back
  }

  return path.basename(cwd);
}

/**
 * The normalized repo identity (rt-client's settings/identity.ts) that keys
 * a repoScoped setting's `repos.<identity>` section — `host/path`, derived
 * from the same `origin` remote the VS Code Git API already has in memory.
 * Sync and spawn-free (unlike rt-client's `deriveRepoIdentity`, which shells
 * out to git): the extension always has a `GitRepository` in hand already,
 * so there is no path-only case to derive from. Null for a repo with no
 * `origin` remote, or one whose remote doesn't match a recognized host form
 * (e.g. a bare local path) — repo-scoped settings are simply unreachable for
 * that repo, same honest degrade as the resolver's own contract.
 */
export function resolveRepoIdentity(repo: GitRepository): string | null {
  const remoteUrl = getRemoteUrl(repo);
  if (!remoteUrl) return null;
  return repoIdentityFromRemote(remoteUrl);
}
