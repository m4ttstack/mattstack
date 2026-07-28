import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
}

type CommandCallback = (command: string, args: string[], cwd: string, exitCode: number, duration: number) => void;

let _onCommand: CommandCallback | null = null;

/** Set a global callback that fires after every git command. Pass null to clear. */
export function setCommandHook(cb: CommandCallback | null): void {
  _onCommand = cb;
}

/** Run a git command and return stdout. Throws on non-zero exit. */
function git(args: string[], cwd: string): Promise<ExecResult> {
  const hook = _onCommand;
  const start = hook ? performance.now() : 0;
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (hook) hook('git', args, cwd, 1, Math.round(performance.now() - start));
        const message = `git ${args.join(' ')} failed: ${stderr.trim() || err.message}`;
        // The raw stderr rides along: the composed message embeds the caller's
        // own argv, so anything matching on git's wording must read this.
        reject(Object.assign(new Error(message), { stderr: stderr.trim() }));
        return;
      }
      if (hook) hook('git', args, cwd, 0, Math.round(performance.now() - start));
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * Split the output of a `-z` git listing into paths.
 *
 * Every path-listing command git has quotes "unusual" paths by default:
 * `core.quotePath` (on by default) C-quotes non-ASCII bytes, and quotes,
 * backslashes and control characters are quoted whatever that setting says.
 * A quoted path is not a path — `join(cwd, '"caf\\303\\251.txt"')` addresses
 * a file that does not exist. `-z` output is NUL-separated and never quoted,
 * so this is the only listing form callers can hand to the filesystem.
 */
function splitNulPaths(stdout: string): string[] {
  return stdout ? stdout.split('\0').filter(Boolean) : [];
}

/** Parse CONFLICT lines from merge-tree stdout into structured entries. */
function parseMergeTreeConflicts(output: string): { file: string; kind: string }[] {
  const conflicts: { file: string; kind: string }[] = [];
  // Two formats:
  //   CONFLICT (content): Merge conflict in <path>
  //   CONFLICT (modify/delete): <path> deleted/added ...
  //   CONFLICT (file location): <path> added in ...
  const reContent = /CONFLICT \(([^)]+)\): Merge conflict in (\S+)/g;
  const reOther = /CONFLICT \(([^)]+)\): (\S+)/g;

  let m: RegExpExecArray | null;
  // First pass: content conflicts ("Merge conflict in <path>")
  while ((m = reContent.exec(output)) !== null) {
    conflicts.push({ kind: m[1]!, file: m[2]! });
  }
  // Second pass: other conflict types (path is right after ": ")
  while ((m = reOther.exec(output)) !== null) {
    const file = m[2]!;
    // Skip if we already captured this via the content regex, or if it's "Merge"
    if (file === 'Merge') continue;
    if (conflicts.some((c) => c.file === file)) continue;
    conflicts.push({ kind: m[1]!, file });
  }
  return conflicts.length > 0 ? conflicts : [{ file: 'unknown', kind: 'conflict' }];
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  locked: boolean;
}

/** The working tree's changed paths, as raw (never quoted) paths. */
export interface ChangedFiles {
  /** Differs between the working tree and the index. */
  modified: string[];
  /** Differs between the index and HEAD. */
  staged: string[];
  /** Not tracked and not ignored. */
  untracked: string[];
  /** The paths above git reports as deletions, staged or not. */
  deleted: string[];
}

/** One index entry: the file mode and blob the index holds for a path. */
export interface IndexEntry {
  /** Six-digit octal git file mode, e.g. `100644`, `100755`, `120000`. */
  mode: string;
  /** Blob sha the index points at. */
  sha: string;
}

/** Outcome of resolving a caller-supplied revision to a commit sha. */
export type RefResolution =
  | { kind: 'resolved'; sha: string }
  /** `candidates` are the commits the abbreviation matches: always two or more. */
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'unknown' };

// An ambiguous abbreviation and an unknown revision both exit 128, and this
// line is the only thing separating them. Matching on the word "ambiguous"
// alone would be wrong: plain (non---verify) rev-parse reports an unknown ref
// as "ambiguous argument '<ref>': unknown revision". Verified against git
// 2.50; older gits wrote "short SHA1" for the same condition.
const AMBIGUOUS_OBJECT_ID = /short (?:object ID|SHA1) \S+ is ambiguous/i;

/** Git's object type for a full sha, or null if git cannot read it. */
async function objectType(cwd: string, sha: string): Promise<string | null> {
  try {
    const { stdout } = await git(['cat-file', '-t', sha], cwd);
    return stdout;
  } catch {
    return null;
  }
}

// ── GitShell ─────────────────────────────────────────────────────────────────

/**
 * Thin, typed wrapper around the git CLI.
 * All methods require a `cwd` (the repo root).
 */
export const GitShell = {
  /** Get the current branch name. */
  async getCurrentBranch(cwd: string): Promise<string> {
    const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return stdout;
  },

  /** Get the HEAD commit SHA of a branch. */
  async getBranchHead(cwd: string, branch: string): Promise<string> {
    const { stdout } = await git(['rev-parse', branch], cwd);
    return stdout;
  },

  /**
   * Resolve any revision git accepts (short sha, full sha, tag, `HEAD~2`,
   * branch name) to a full commit sha, telling an ambiguous abbreviation
   * apart from one that resolves to nothing.
   *
   * `^{commit}` peels annotated tags and lets git disambiguate by object type,
   * so an abbreviation shared with a blob or tree still resolves to the commit.
   * An abbreviation is only `ambiguous` when two or more *commits* answer to
   * it; one shared with nothing but blobs resolves to no commit at all.
   */
  async resolveRef(cwd: string, ref: string): Promise<RefResolution> {
    try {
      const { stdout } = await git(['rev-parse', '--verify', `${ref}^{commit}`], cwd);
      return { kind: 'resolved', sha: stdout };
    } catch (err) {
      // Only git's own stderr is evidence. The composed message embeds the
      // caller's argv, which could carry the same words.
      const stderr = (err as { stderr?: string } | null)?.stderr ?? '';
      if (!AMBIGUOUS_OBJECT_ID.test(stderr)) return { kind: 'unknown' };
      const candidates = await GitShell.disambiguate(cwd, ref);
      if (candidates.length < 2) return { kind: 'unknown' };
      return { kind: 'ambiguous', candidates };
    }
  },

  /**
   * List every commit whose sha starts with `prefix`. Empty for non-hex input,
   * or for a prefix under the four digits `--disambiguate` insists on.
   *
   * Blobs and trees are dropped: a prefix shared only with them is not an
   * ambiguous commit, and "use more characters" would be advice the caller
   * cannot act on. Tag objects stay, since they name a commit once peeled.
   */
  async disambiguate(cwd: string, prefix: string): Promise<string[]> {
    let matches: string[];
    try {
      const { stdout } = await git(['rev-parse', `--disambiguate=${prefix}`], cwd);
      matches = stdout.split('\n').filter(Boolean);
    } catch {
      return [];
    }
    const types = await Promise.all(matches.map((sha) => objectType(cwd, sha)));
    return matches.filter((_, i) => types[i] === 'commit' || types[i] === 'tag');
  },

  /** Get the merge-base between two refs. */
  async getMergeBase(cwd: string, a: string, b: string): Promise<string> {
    const { stdout } = await git(['merge-base', a, b], cwd);
    return stdout;
  },

  /** Check whether a branch exists locally. */
  async branchExists(cwd: string, branch: string): Promise<boolean> {
    try {
      await git(['rev-parse', '--verify', branch], cwd);
      return true;
    } catch {
      return false;
    }
  },

  /** Create a new branch from a starting point and check it out. */
  async createBranch(cwd: string, name: string, from: string): Promise<void> {
    await git(['checkout', '-b', name, from], cwd);
  },

  /** Create a branch ref without touching any working tree. */
  async branchAt(cwd: string, name: string, from: string): Promise<void> {
    await git(['branch', name, from], cwd);
  },

  /** Switch to an existing branch. */
  async checkoutBranch(cwd: string, branch: string): Promise<void> {
    await git(['checkout', branch], cwd);
  },

  /**
   * Rebase a branch onto a new base.
   * `git rebase --onto <newBase> <oldBase> <branch>`
   */
  async rebaseOnto(cwd: string, newBase: string, oldBase: string, branch: string): Promise<void> {
    await git(['rebase', '--onto', newBase, oldBase, branch], cwd);
  },

  /** Force-push with lease (safe force-push). */
  async pushForceWithLease(cwd: string, branch: string, remote = 'origin'): Promise<void> {
    await git(['push', '--force-with-lease', remote, branch], cwd);
  },

  /** All worktrees of the repo: path, HEAD sha, and checked-out branch (null when detached). */
  async worktreeList(cwd: string): Promise<{ path: string; head: string; branch: string | null }[]> {
    const { stdout } = await git(['worktree', 'list', '--porcelain'], cwd);
    const out: { path: string; head: string; branch: string | null }[] = [];
    let current: { path?: string; head?: string; branch: string | null } = { branch: null };
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length), branch: null };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch refs/heads/')) {
        current.branch = line.slice('branch refs/heads/'.length);
      } else if (line.trim() === '' && current.path && current.head) {
        out.push({ path: current.path, head: current.head, branch: current.branch });
        current = { branch: null };
      }
    }
    if (current.path && current.head) {
      out.push({ path: current.path, head: current.head, branch: current.branch });
    }
    return out;
  },

  /** Create a detached worktree at `path` pointing at `ref`. Hooks are
      disabled for the creation checkout: repo hooks (e.g. husky) expect an
      installed dev environment the fresh worktree does not have. */
  async worktreeAddDetached(cwd: string, path: string, ref: string): Promise<void> {
    await git(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', path, ref], cwd);
  },

  /** Persistently disable hooks for one worktree (gitq's mechanical slots):
      per-worktree config so human checkouts keep their hooks. */
  async disableWorktreeHooks(worktreePath: string): Promise<void> {
    await git(['config', 'extensions.worktreeConfig', 'true'], worktreePath);
    await git(['config', '--worktree', 'core.hooksPath', '/dev/null'], worktreePath);
  },

  /** Detach HEAD in `cwd` at `ref` without touching any branch ref. */
  async detachAt(cwd: string, ref: string): Promise<void> {
    await git(['checkout', '--detach', ref], cwd);
  },

  /** Rebase the current (detached) HEAD: replays oldBase..HEAD onto newBase. */
  async rebaseOntoDetached(cwd: string, newBase: string, oldBase: string): Promise<void> {
    await git(['rebase', '--onto', newBase, oldBase], cwd);
  },

  /** Compare-and-swap a branch ref. Throws (without moving the ref) when the
      branch no longer points at expectedOldSha. Exempt from git's
      checked-out-branch guard, which is exactly why finalization uses it. */
  async updateRefCas(cwd: string, branch: string, newSha: string, expectedOldSha: string): Promise<void> {
    await git(['update-ref', `refs/heads/${branch}`, newSha, expectedOldSha], cwd);
  },

  /** Check if the working tree has uncommitted changes (staged or unstaged). */
  async isDirty(cwd: string): Promise<boolean> {
    const { stdout } = await git(['status', '--porcelain'], cwd);
    return stdout.length > 0;
  },

  /**
   * Check for unstaged (working tree) modifications only.
   * Returns false when only staged changes exist (e.g. after port-file).
   */
  async hasUnstagedChanges(cwd: string): Promise<boolean> {
    try {
      await git(['diff', '--quiet'], cwd);
      return false; // exit 0 = no unstaged changes
    } catch {
      return true; // exit 1 = unstaged changes exist
    }
  },

  /** Check if there are staged (index) changes. */
  async hasStagedChanges(cwd: string): Promise<boolean> {
    try {
      await git(['diff', '--cached', '--quiet'], cwd);
      return false; // exit 0 = no staged changes
    } catch {
      return true; // exit 1 = staged changes exist
    }
  },

  /** Get the git log for a branch (one line per commit). */
  async log(cwd: string, branch: string, n = 20): Promise<string[]> {
    const { stdout } = await git(['log', '--oneline', `-${n}`, branch], cwd);
    return stdout ? stdout.split('\n') : [];
  },

  /** Get the repo root directory. */
  async getRepoRoot(cwd: string): Promise<string> {
    const { stdout } = await git(['rev-parse', '--show-toplevel'], cwd);
    return stdout;
  },

  /** Get the remote URL (e.g. origin). */
  async getRemoteUrl(cwd: string, remote = 'origin'): Promise<string> {
    const { stdout } = await git(['remote', 'get-url', remote], cwd);
    return stdout;
  },

  /**
   * Three-way merge-tree — predicts conflicts without touching the working tree.
   * Uses `--write-tree` mode (Git 2.38+): exits non-zero when conflicts are detected.
   */
  async mergeTree(cwd: string, branch1: string, branch2: string): Promise<string> {
    const { stdout } = await git(['merge-tree', '--write-tree', branch1, branch2], cwd);
    return stdout;
  },

  /**
   * Three-way merge-tree with an explicit merge base — predicts conflicts
   * for `git rebase --onto <branch1> <mergeBase> <branch2>` scenarios.
   * Uses `--merge-base` (Git 2.38+) to specify the fork point.
   */
  async mergeTreeWithBase(cwd: string, branch1: string, branch2: string, mergeBase: string): Promise<string> {
    const { stdout } = await git(['merge-tree', '--write-tree', `--merge-base=${mergeBase}`, branch1, branch2], cwd);
    return stdout;
  },

  /**
   * Dry-run merge-tree that returns structured conflict details instead of throwing.
   * Returns null if clean, or an array of { file, kind } conflict entries.
   *
   * Uses execFile directly because `merge-tree --write-tree` writes CONFLICT
   * details to stdout (not stderr), and we need stdout even on non-zero exit.
   */
  async mergeTreeDryRun(
    cwd: string,
    branch1: string,
    branch2: string,
    mergeBase?: string | null,
  ): Promise<{ file: string; kind: string }[] | null> {
    const args = mergeBase
      ? ['merge-tree', '--write-tree', `--merge-base=${mergeBase}`, branch1, branch2]
      : ['merge-tree', '--write-tree', branch1, branch2];

    return new Promise((resolve) => {
      execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (!err) {
          resolve(null); // clean merge
          return;
        }
        // Non-zero exit — parse CONFLICT lines from stdout
        resolve(parseMergeTreeConflicts(stdout));
      });
    });
  },

  /** Get structured commit log for a branch (sha + subject). */
  async logDetailed(cwd: string, branch: string, n = 50): Promise<{ sha: string; subject: string }[]> {
    const { stdout } = await git(['log', '--format=%H %s', `-${n}`, branch], cwd);
    if (!stdout) return [];
    return stdout.split('\n').map((line) => {
      const spaceIdx = line.indexOf(' ');
      return {
        sha: line.slice(0, spaceIdx),
        subject: line.slice(spaceIdx + 1),
      };
    });
  },

  /** Hard-reset the current branch to a specific ref. */
  async resetHard(cwd: string, ref: string): Promise<void> {
    await git(['reset', '--hard', ref], cwd);
  },

  /** Get the diff between two refs (e.g. for AI description generation). */
  async diff(cwd: string, base: string, head: string): Promise<string> {
    const { stdout } = await git(['diff', `${base}...${head}`], cwd);
    return stdout;
  },

  /** Get the working tree diff (staged + unstaged vs HEAD). Useful during paused rebase. */
  async diffWorkingTree(cwd: string): Promise<string> {
    const { stdout } = await git(['diff', 'HEAD'], cwd);
    return stdout;
  },

  /**
   * Get rebase progress (commit position / total).
   * Reads from `.git/rebase-merge/msgnum` and `end`.
   * Returns null if no rebase is in progress.
   */
  getRebaseProgress(cwd: string): { current: number; total: number } | null {
    try {
      // Handle worktrees: .git might be a file pointing to the real git dir
      let gitDir = join(cwd, '.git');
      try {
        const content = readFileSync(gitDir, 'utf-8').trim();
        if (content.startsWith('gitdir: ')) {
          const relative = content.slice('gitdir: '.length);
          gitDir = relative.startsWith('/') ? relative : join(cwd, relative);
        }
      } catch { /* .git is a directory, not a file — use as-is */ }

      const rebaseDir = join(gitDir, 'rebase-merge');
      if (!existsSync(rebaseDir)) return null;

      const current = parseInt(readFileSync(join(rebaseDir, 'msgnum'), 'utf-8').trim(), 10);
      const total = parseInt(readFileSync(join(rebaseDir, 'end'), 'utf-8').trim(), 10);
      return { current, total };
    } catch {
      return null;
    }
  },

  /** List files with unmerged conflict markers (during a rebase/merge conflict). */
  async listConflictedFiles(cwd: string): Promise<string[]> {
    const { stdout } = await git(['diff', '--name-only', '--diff-filter=U'], cwd);
    return stdout ? stdout.split('\n').filter(Boolean) : [];
  },

  /**
   * List conflicted files with their conflict type codes.
   * Uses `git status --porcelain` to extract unmerged entries.
   * Type codes: UU (both modified), UD (ours modified, theirs deleted),
   * DU (ours deleted, theirs modified), AU (added by us, unmerged),
   * UA (unmerged, added by them), AA (both added).
   */
  async listConflictedFilesWithTypes(cwd: string): Promise<{ file: string; type: string }[]> {
    const { stdout } = await git(['status', '--porcelain'], cwd);
    if (!stdout) return [];
    return stdout.split('\n')
      .filter((line) => {
        const xy = line.slice(0, 2);
        // Unmerged statuses: DD, AU, UD, UA, DU, AA, UU
        return xy === 'DD' || xy === 'AU' || xy === 'UD' ||
               xy === 'UA' || xy === 'DU' || xy === 'AA' || xy === 'UU';
      })
      .map((line) => ({
        type: line.slice(0, 2),
        file: line.slice(3),
      }));
  },

  /** Continue a paused rebase after conflicts have been resolved. */
  async rebaseContinue(cwd: string): Promise<void> {
    await git(['-c', 'core.editor=true', 'rebase', '--continue'], cwd);
  },

  /** Abort a rebase in progress, restoring the branch to its pre-rebase state. */
  async rebaseAbort(cwd: string): Promise<void> {
    await git(['rebase', '--abort'], cwd);
  },

  /** Skip the current commit during a rebase (when the commit is redundant). */
  async rebaseSkip(cwd: string): Promise<void> {
    await git(['rebase', '--skip'], cwd);
  },

  /** Resolve conflicted files to the HEAD (target) version. */
  async checkoutOurs(cwd: string, file: string): Promise<void> {
    await git(['checkout', '--ours', '--', file], cwd);
  },

  /** Resolve conflicted files to the incoming (merge/rebase source) version. */
  async checkoutTheirs(cwd: string, file: string): Promise<void> {
    await git(['checkout', '--theirs', '--', file], cwd);
  },

  /** Stage all changes (including untracked). */
  async stageAll(cwd: string): Promise<void> {
    await git(['add', '-A'], cwd);
  },

  /** Restore merge conflict markers for specific files (undo a checkout --ours). */
  async checkoutMerge(cwd: string, file: string): Promise<void> {
    await git(['checkout', '-m', '--', file], cwd);
  },

  /** Check if there are staged changes relative to HEAD (for detecting empty commits). */
  async hasStagedDiff(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await git(['diff', '--cached', '--quiet', 'HEAD'], cwd);
      return false; // exit 0 = no diff
    } catch {
      return true; // exit 1 = has diff
    }
  },

  /** Check if a rebase is currently in progress by looking for git state directories. */
  isRebaseInProgress(cwd: string): boolean {
    try {
      // Handle worktrees: .git might be a file pointing to the real git dir
      let gitDir = join(cwd, '.git');
      try {
        const content = readFileSync(gitDir, 'utf-8').trim();
        if (content.startsWith('gitdir: ')) {
          const relative = content.slice('gitdir: '.length);
          gitDir = relative.startsWith('/') ? relative : join(cwd, relative);
        }
      } catch { /* .git is a directory, not a file — use as-is */ }

      return existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'));
    } catch {
      return false;
    }
  },

  /** Get the SHA of the commit currently being replayed during a rebase conflict. */
  getStoppedSha(cwd: string): string | null {
    try {
      // Handle worktrees: .git might be a file pointing to the real git dir
      let gitDir = join(cwd, '.git');
      try {
        const content = readFileSync(gitDir, 'utf-8').trim();
        if (content.startsWith('gitdir: ')) {
          const relative = content.slice('gitdir: '.length);
          gitDir = relative.startsWith('/') ? relative : join(cwd, relative);
        }
      } catch { /* .git is a directory, not a file — use as-is */ }

      const stoppedPath = join(gitDir, 'rebase-merge', 'stopped-sha');
      if (existsSync(stoppedPath)) {
        return readFileSync(stoppedPath, 'utf-8').trim();
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Get the lines added by a specific commit to a specific file.
   * Returns the added lines (without the '+' prefix) for superset comparison.
   */
  async getCommitDiffAddedLines(cwd: string, sha: string, file: string): Promise<string[]> {
    try {
      const { stdout } = await git(['diff', `${sha}~1`, sha, '--', file], cwd);
      if (!stdout) return [];
      return stdout
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1)); // remove '+' prefix
    } catch {
      return [];
    }
  },

  /** Get the content of a file at a specific revision. */
  async showFile(cwd: string, revision: string, file: string): Promise<{ stdout: string }> {
    return git(['show', `${revision}:${file}`], cwd);
  },

  /** Fetch from a remote (defaults to origin). */
  async fetch(cwd: string, remote = 'origin'): Promise<void> {
    await git(['fetch', remote], cwd);
  },

  /** Rename a local branch. */
  async renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
    await git(['branch', '-m', oldName, newName], cwd);
  },

  /**
   * List files changed between two refs. `-z` so the paths come back raw:
   * absorb compares these against {@link getChangedFiles}, and one side
   * quoting `café.txt` while the other does not is a silent mis-attribution.
   */
  async getFilesChangedInRange(cwd: string, fromRef: string, toRef: string): Promise<string[]> {
    const { stdout } = await git(['diff', '--name-only', '-z', fromRef, toRef], cwd);
    return splitNulPaths(stdout);
  },

  /** Stash all changes (including untracked files). */
  async stash(cwd: string): Promise<void> {
    await git(['stash', 'push', '-u'], cwd);
  },

  /** Pop the most recent stash entry. */
  async stashPop(cwd: string): Promise<void> {
    await git(['stash', 'pop'], cwd);
  },

  /** Drop the most recent stash entry. */
  async stashDrop(cwd: string): Promise<void> {
    await git(['stash', 'drop'], cwd);
  },

  /** Restore a single file from a ref (e.g. from stash). */
  async checkoutFileFromRef(cwd: string, ref: string, filePath: string): Promise<void> {
    await git(['checkout', ref, '--', filePath], cwd);
  },

  /** Amend the last commit without changing its message. */
  async amendNoEdit(cwd: string): Promise<void> {
    await git(['commit', '--amend', '--no-edit', '--allow-empty'], cwd);
  },

  /**
   * Get all changed files: modified (unstaged) + staged + untracked, plus the
   * subset git reports as deleted (`deleted` is a view over the other two
   * lists, not a fourth disjoint set).
   *
   * Every listing runs with `-z`. Without it git hands back C-quoted paths for
   * anything non-ASCII or containing quotes, backslashes or control
   * characters, and a caller that hands that string to the filesystem misses
   * the file entirely — see {@link splitNulPaths}.
   *
   * `deleted` exists so a caller can tell "this file is gone because the user
   * deleted it" from "this file could not be read", which are the same
   * observation from the filesystem and opposite instructions for a restore.
   */
  async getChangedFiles(cwd: string): Promise<ChangedFiles> {
    const [modResult, stagedResult, untrackedResult, delResult, delStagedResult] = await Promise.all([
      git(['diff', '--name-only', '-z'], cwd),
      git(['diff', '--name-only', '-z', '--cached'], cwd),
      git(['ls-files', '--others', '--exclude-standard', '-z'], cwd),
      git(['diff', '--name-only', '-z', '--diff-filter=D'], cwd),
      git(['diff', '--name-only', '-z', '--cached', '--diff-filter=D'], cwd),
    ]);
    return {
      modified: splitNulPaths(modResult.stdout),
      staged: splitNulPaths(stagedResult.stdout),
      untracked: splitNulPaths(untrackedResult.stdout),
      deleted: [
        ...new Set([...splitNulPaths(delResult.stdout), ...splitNulPaths(delStagedResult.stdout)]),
      ],
    };
  },

  /**
   * The index entry (file mode + blob sha) for each given path that the index
   * holds at stage 0. A path the index has no entry for is simply absent from
   * the map — for a staged deletion that absence IS the state.
   *
   * `--literal-pathspecs` keeps a filename containing `*` or `?` from being
   * read as a pattern; `-z` keeps unusual paths intact.
   */
  async getIndexEntries(cwd: string, files: string[]): Promise<Map<string, IndexEntry>> {
    const entries = new Map<string, IndexEntry>();
    if (files.length === 0) return entries;

    const { stdout } = await git(['--literal-pathspecs', 'ls-files', '-s', '-z', '--', ...files], cwd);
    for (const record of splitNulPaths(stdout)) {
      // "<mode> SP <sha> SP <stage> TAB <path>"
      const tab = record.indexOf('\t');
      if (tab === -1) continue;
      const [mode, sha, stage] = record.slice(0, tab).split(' ');
      if (!mode || !sha || stage !== '0') continue;
      entries.set(record.slice(tab + 1), { mode, sha });
    }
    return entries;
  },

  /**
   * Point the index at a specific blob for a path, leaving the working tree
   * alone. This is how a partially staged file (`git add -p`) gets its split
   * back: the worktree keeps the full edit, the index keeps the staged blob.
   */
  async setIndexEntry(cwd: string, file: string, entry: IndexEntry): Promise<void> {
    await git(['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.sha},${file}`], cwd);
  },

  /** Record a path as removed in the index without touching the working tree. */
  async removeIndexEntry(cwd: string, file: string): Promise<void> {
    await git(['update-index', '--force-remove', '--', file], cwd);
  },

  /** Stage specific files. */
  async add(cwd: string, files: string[]): Promise<void> {
    await git(['add', ...files], cwd);
  },

  /** Cherry-pick a range of commits (exclusive base..head). */
  async cherryPick(cwd: string, base: string, head: string): Promise<void> {
    await git(['cherry-pick', `${base}..${head}`], cwd);
  },

  /** Force-delete a local branch. */
  async deleteBranch(cwd: string, branch: string): Promise<void> {
    await git(['branch', '-D', branch], cwd);
  },

  /**
   * List files changed between a branch and its merge-base with a parent.
   *
   * NUL-terminated: `split --files` matches these against a user-supplied glob
   * and against {@link lsTree}, and a C-quoted `"caf\303\251.ts"` matches
   * neither `café.*` nor the same path read unquoted from somewhere else.
   */
  async diffNameOnly(cwd: string, base: string, head: string): Promise<string[]> {
    const { stdout } = await git(['diff', '--name-only', '-z', base, head], cwd);
    return splitNulPaths(stdout);
  },

  /** Checkout specific files from a ref into the working tree. */
  async checkoutFiles(cwd: string, ref: string, files: string[]): Promise<void> {
    await git(['checkout', ref, '--', ...files], cwd);
  },

  /** Commit with a message. */
  async commit(cwd: string, message: string): Promise<string> {
    await git(['commit', '-m', message], cwd);
    const { stdout } = await git(['rev-parse', 'HEAD'], cwd);
    return stdout;
  },

  /** Remove files from the working tree and index. */
  async rm(cwd: string, files: string[]): Promise<void> {
    await git(['rm', '-f', ...files], cwd);
  },

  /** List files in a tree (ref). NUL-terminated, see {@link diffNameOnly}. */
  async lsTree(cwd: string, ref: string): Promise<string[]> {
    const { stdout } = await git(['ls-tree', '-r', '--name-only', '-z', ref], cwd);
    return splitNulPaths(stdout);
  },

  /** List files under a specific directory path in a tree (ref). */
  async lsTreePath(cwd: string, ref: string, path: string): Promise<string[]> {
    const { stdout } = await git(['ls-tree', '-r', '--name-only', '-z', ref, '--', path], cwd);
    return splitNulPaths(stdout);
  },

  /**
   * Get file change statuses between two refs.
   * Returns entries with status (M, A, D, R) and paths.
   * For renames (R), `to` contains the destination path.
   *
   * NUL-terminated, for the reason in {@link diffNameOnly}. `-z` also drops the
   * tab separator, so each entry is consumed as fields rather than split from a
   * line: a status, then one path, or two when it is a rename or a copy.
   */
  async diffNameStatus(
    cwd: string,
    ref1: string,
    ref2: string,
  ): Promise<{ status: string; path: string; to?: string }[]> {
    const fields = splitNulPaths((await git(['diff', '--name-status', '-z', ref1, ref2], cwd)).stdout);
    const entries: { status: string; path: string; to?: string }[] = [];

    for (let i = 0; i < fields.length; ) {
      const status = fields[i]!.charAt(0); // R100 → R
      const path = fields[i + 1];
      // Truncated output would otherwise invent an entry with an undefined
      // path, which reads as a real change to a file with no name.
      if (path === undefined) break;

      if (status === 'R' || status === 'C') {
        const to = fields[i + 2];
        if (to === undefined) break;
        entries.push({ status, path, to });
        i += 3;
      } else {
        entries.push({ status, path });
        i += 2;
      }
    }

    return entries;
  },

  /** List all local branches. */
  async listLocalBranches(cwd: string): Promise<string[]> {
    const { stdout } = await git(['branch', '--list', '--format=%(refname:short)'], cwd);
    return stdout ? stdout.split('\n').filter(Boolean) : [];
  },

  /** List all worktrees with their checked-out branches. */
  async listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
    const { stdout } = await git(['worktree', 'list', '--porcelain'], cwd);
    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) entries.push(current as WorktreeEntry);
        current = { path: line.slice(9), head: '', branch: null, bare: false, locked: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace(/^refs\/heads\//, '');
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'locked' || line.startsWith('locked ')) {
        current.locked = true;
      } else if (line === 'detached') {
        current.branch = null;
      }
    }
    if (current.path) entries.push(current as WorktreeEntry);
    return entries;
  },

  /** Get the git common dir (canonical repo identity shared across worktrees). */
  async getCommonDir(cwd: string): Promise<string> {
    const { stdout } = await git(['rev-parse', '--git-common-dir'], cwd);
    const { resolve } = await import('node:path');
    const commonDir = resolve(cwd, stdout);
    const parent = resolve(commonDir, '..');
    return parent;
  },

  /** Check if `ancestor` is an ancestor of `descendant`. */
  async isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
    try {
      await git(['merge-base', '--is-ancestor', ancestor, descendant], cwd);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Reflog-based fork point detection (Git 2.6+).
   * Finds where `branch` originally diverged from `upstream`, even after
   * `upstream` was rebased. Returns null if the reflog doesn't cover the
   * fork (entries expired or fresh clone).
   */
  async getMergeBaseForkPoint(cwd: string, upstream: string, branch: string): Promise<string | null> {
    try {
      const { stdout } = await git(['merge-base', '--fork-point', upstream, branch], cwd);
      return stdout || null;
    } catch {
      return null;
    }
  },

  /**
   * Patch-ID based duplicate detection via `git cherry`.
   * Returns each commit in `upstream..head` annotated with whether it is
   * unique (`+`) or has an equivalent patch already in upstream (`-`).
   */
  async cherry(cwd: string, upstream: string, head: string): Promise<{ sha: string; unique: boolean }[]> {
    const { stdout } = await git(['cherry', '-v', upstream, head], cwd);
    if (!stdout) return [];
    return stdout.split('\n').filter(Boolean).map((line) => {
      const unique = line.startsWith('+');
      const sha = line.slice(2, line.indexOf(' ', 2));
      return { sha, unique };
    });
  },

  /** Validate that a git object exists. Returns the object type or null if missing. */
  async catFileType(cwd: string, sha: string): Promise<string | null> {
    try {
      const { stdout } = await git(['cat-file', '-t', sha], cwd);
      return stdout || null;
    } catch {
      return null;
    }
  },

  // ── Divergence detection ─────────────────────────────────────────────

  /**
   * Detect the divergence state between a local branch and its remote tracking branch.
   *
   * Returns:
   * - 'identical': local and remote are at the same commit
   * - 'ahead': local has commits remote doesn't (needs push)
   * - 'behind': remote has commits local doesn't (needs pull / reset)
   * - 'diverged': both have unique commits (force-push or rebase needed)
   * - 'remote-gone': remote tracking branch doesn't exist
   * - 'local-gone': local branch doesn't exist
   */
  async branchDivergence(
    cwd: string,
    branch: string,
    remote = 'origin',
  ): Promise<{
    state: 'identical' | 'ahead' | 'behind' | 'diverged' | 'remote-gone' | 'local-gone';
    localHead: string | null;
    remoteHead: string | null;
    ahead: number;
    behind: number;
  }> {
    const remoteBranch = `${remote}/${branch}`;

    // Check local existence
    let localHead: string | null;
    try {
      localHead = await GitShell.getBranchHead(cwd, branch);
    } catch {
      return { state: 'local-gone', localHead: null, remoteHead: null, ahead: 0, behind: 0 };
    }

    // Check remote existence
    let remoteHead: string | null;
    try {
      remoteHead = await GitShell.getBranchHead(cwd, remoteBranch);
    } catch {
      return { state: 'remote-gone', localHead, remoteHead: null, ahead: 0, behind: 0 };
    }

    if (localHead === remoteHead) {
      return { state: 'identical', localHead, remoteHead, ahead: 0, behind: 0 };
    }

    // Count commits unique to each side
    const ahead = await GitShell.revCount(cwd, remoteBranch, branch);
    const behind = await GitShell.revCount(cwd, branch, remoteBranch);

    if (behind === 0) return { state: 'ahead', localHead, remoteHead, ahead, behind };
    if (ahead === 0) return { state: 'behind', localHead, remoteHead, ahead, behind };
    return { state: 'diverged', localHead, remoteHead, ahead, behind };
  },

  /** Count commits reachable from `to` but not from `from`. */
  async revCount(cwd: string, from: string, to: string): Promise<number> {
    try {
      const { stdout } = await git(['rev-list', '--count', `${from}..${to}`], cwd);
      return parseInt(stdout, 10) || 0;
    } catch {
      return 0;
    }
  },

  /**
   * Reset a local branch to match its remote tracking branch.
   * If the branch is currently checked out, uses `git reset --hard`.
   * Otherwise, updates the branch ref directly.
   */
  async resetBranchToRemote(cwd: string, branch: string, remote = 'origin'): Promise<void> {
    const remoteBranch = `${remote}/${branch}`;
    const current = await GitShell.getCurrentBranch(cwd);

    if (current === branch) {
      await git(['reset', '--hard', remoteBranch], cwd);
    } else {
      // Update the branch ref without checking it out
      await git(['branch', '-f', branch, remoteBranch], cwd);
    }
  },

  /**
   * Get structured commit log for a range (sha + subject).
   * Wraps `git log --format='%H %s' <range>`.
   * Range can be `A..B` (commits in B not in A) or a branch name.
   *
   * Throws if git cannot walk the range, so an empty result always means an
   * empty range and never a failed command.
   */
  async logOneLine(cwd: string, range: string): Promise<{ sha: string; message: string }[]> {
    const { stdout } = await git(['log', '--format=%H %s', range], cwd);
    if (!stdout) return [];
    return stdout.split('\n').filter(Boolean).map((line) => {
      const spaceIdx = line.indexOf(' ');
      return {
        sha: line.slice(0, spaceIdx),
        message: line.slice(spaceIdx + 1),
      };
    });
  },
};

