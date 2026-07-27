import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { assertCleanTree } from './git-guards.ts';
import { finalizeBranchRef } from './rebase-engine.ts';
import picomatch from 'picomatch';

// ── Result types ─────────────────────────────────────────────────────────────

/** Result of a tail-split operation. */
export interface SplitResult {
  /** The new child branch name. */
  newBranch: string;
  /** Commit SHAs moved to the new branch. */
  movedCommits: string[];
  /** Updated stack with the new node added. */
  updatedStack: Stack;
}

/** Result of a split-by-file operation. */
export interface SplitByFileResult {
  /** Source branch (files matching patterns removed). */
  sourceBranch: string;
  /** New branch containing the matched files. */
  newBranch: string;
  /** Files moved to the new branch. */
  movedFiles: string[];
  /** Files remaining on the source branch. */
  remainingFiles: string[];
  /** Updated stack with the new branch added. */
  newStack: Stack;
}

// ── BranchSplitter ───────────────────────────────────────────────────────────

/**
 * Tail-split primitive for breaking large branches into smaller stacked branches.
 *
 * Pure ref surgery: no working tree is read or written. The operation is:
 * 1. Create a new branch at source HEAD (preserves all commits)
 * 2. CAS-rewind the source branch to splitAfterSha via finalizeBranchRef
 *    (a checked-out source gets the slot policy: clean auto-resets, dirty refuses)
 * 3. Add new branch as child of source in the stack tree
 * 4. Update lastKnownHead on both branches
 */
export const BranchSplitter = {
  /**
   * Tail-split: move commits after `splitAfterSha` into a new child branch.
   *
   * Safety: the new branch is created BEFORE the reset, so no commits are ever
   * unreachable — even if the process crashes between steps.
   *
   * @param cwd            - Repo root directory.
   * @param stack          - The stack containing the source branch.
   * @param sourceBranch   - Branch to split (must be in the stack).
   * @param newBranchName  - Name for the new child branch.
   * @param splitAfterSha  - Commit to split after (commits after it move to the new
   *                         branch). Any revision git resolves: short or full sha,
   *                         tag, `HEAD~2`, branch name.
   */
  async tailSplit(
    cwd: string,
    stack: Stack,
    sourceBranch: string,
    newBranchName: string,
    splitAfterSha: string,
  ): Promise<SplitResult> {
    // Validate: source branch exists in the stack
    const sourceNode = StackManager.findNode(stack, sourceBranch);
    if (!sourceNode) {
      throw new Error(`Branch "${sourceBranch}" not found in stack "${stack.id}"`);
    }

    // Validate: new branch name doesn't already exist in the stack
    if (StackManager.findNode(stack, newBranchName) || newBranchName === stack.root) {
      throw new Error(`Branch "${newBranchName}" already exists in stack "${stack.id}"`);
    }

    // Ref-only surgery: the new branch keeps the full history; the source
    // ref rewinds to the split point. No working tree is read or written,
    // so launch-tree dirtiness is irrelevant; a checked-out source gets the
    // slot policy (clean: auto-reset, dirty: refuse) via finalizeBranchRef.
    const resolution = await GitShell.resolveRef(cwd, splitAfterSha);
    if (resolution.kind === 'ambiguous') {
      const shown = resolution.candidates.map((c) => c.slice(0, 10)).join(', ');
      throw new Error(
        `Commit "${splitAfterSha}" is an ambiguous abbreviation${shown ? ` (matches ${shown})` : ''}; use more characters`,
      );
    }
    if (resolution.kind === 'unknown') {
      throw new Error(`Commit "${splitAfterSha}" does not resolve to a commit in this repository`);
    }
    const splitSha = resolution.sha;

    // Containment is asked of git rather than scanned out of a commit log, so
    // no search window can make an old-but-present commit look missing:
    // merge-base(x, branch) is x exactly when x is reachable from the tip.
    // Unrelated histories have no merge base at all, which is a plain no.
    let onSourceBranch = false;
    try {
      onSourceBranch = (await GitShell.getMergeBase(cwd, splitSha, sourceBranch)) === splitSha;
    } catch {
      onSourceBranch = false;
    }
    if (!onSourceBranch) {
      throw new Error(`Commit "${splitAfterSha}" not found in branch "${sourceBranch}"`);
    }

    // Commits at and before the split point stay on source; everything the
    // range turns up (newest first) moves to the new branch.
    const movedCommits = (await GitShell.logOneLine(cwd, `${splitSha}..${sourceBranch}`)).map((c) => c.sha);
    if (movedCommits.length === 0) {
      throw new Error('No commits to split — the split point is already at HEAD');
    }

    const sourceHead = await GitShell.getBranchHead(cwd, sourceBranch);
    await GitShell.branchAt(cwd, newBranchName, sourceHead);
    const fin = await finalizeBranchRef(cwd, sourceBranch, sourceHead, splitSha);
    if (!fin.success) {
      await GitShell.deleteBranch(cwd, newBranchName).catch(() => {});
      throw new Error(fin.error ?? 'could not rewind the source branch');
    }

    // Step 3: Update the stack tree
    // Add new branch as child of source FIRST (so re-parenting can find it)
    let updatedStack = StackManager.addNode(stack, newBranchName, sourceBranch);

    // Re-parent any existing children of source to the new branch
    // (they were based on the full commit range, which now lives on newBranch)
    const sourceChildren = StackManager.getChildren(stack, sourceBranch);
    for (const child of sourceChildren) {
      updatedStack = StackManager.moveNode(updatedStack, child.branch, newBranchName);
    }

    // Step 4: Update lastKnownHead on both branches
    const newSourceHead = await GitShell.getBranchHead(cwd, sourceBranch);
    updatedStack = StackManager.updateNode(updatedStack, sourceBranch, {
      lastKnownHead: newSourceHead,
    });
    updatedStack = StackManager.updateNode(updatedStack, newBranchName, {
      lastKnownHead: sourceHead,
    });

    return {
      newBranch: newBranchName,
      movedCommits,
      updatedStack,
    };
  },

  /**
   * Get the commit log for a branch, suitable for the split-point picker UI.
   *
   * Returns commits in reverse chronological order (newest first).
   *
   * `n` is a display window for the picker only. `tailSplit` resolves and
   * range-walks through git instead of reading this, so a commit older than
   * `n` is still a valid split point.
   */
  async getCommitLog(cwd: string, branch: string, n = 50): Promise<{ sha: string; subject: string }[]> {
    return GitShell.logDetailed(cwd, branch, n);
  },

  /**
   * Get the list of files changed in a branch relative to its parent (merge-base).
   */
  async getChangedFileList(cwd: string, branch: string, parentBranch: string): Promise<string[]> {
    const mergeBase = await GitShell.getMergeBase(cwd, branch, parentBranch);
    return GitShell.diffNameOnly(cwd, mergeBase, branch);
  },

  /**
   * Split a branch by file pattern: files matching the patterns move to a new
   * child branch, while the source branch keeps only the remaining files.
   *
   * Both branches are based on the same merge-base with the parent.
   *
   * @param cwd           - Repo root directory.
   * @param stack         - The stack containing the source branch.
   * @param branch        - Branch to split (must be in the stack).
   * @param filePatterns  - Glob patterns for files to move (e.g. ["*.ts", "src/api/**"]).
   * @param newBranchName - Name for the new branch that will contain matched files.
   * @param workDir       - Leased, detached work slot. Without it, runs natively in
   *                        `cwd` (checks out both branches there, requires a clean
   *                        tree). With it, both commits are built detached in the
   *                        slot and the source tip is rewritten by CAS via
   *                        `finalizeBranchRef`; the launch tree is never touched.
   */
  async splitByFile(
    cwd: string,
    stack: Stack,
    branch: string,
    filePatterns: string[],
    newBranchName: string,
    workDir?: string,
  ): Promise<SplitByFileResult> {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new Error(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    if (StackManager.findNode(stack, newBranchName) || newBranchName === stack.root) {
      throw new Error(`Branch "${newBranchName}" already exists in stack "${stack.id}"`);
    }

    const parentBranch = node.parent;
    const mergeBase = await GitShell.getMergeBase(cwd, branch, parentBranch);

    const allFiles = await GitShell.diffNameOnly(cwd, mergeBase, branch);
    if (allFiles.length === 0) {
      throw new Error(`Branch "${branch}" has no changed files relative to "${parentBranch}"`);
    }

    const matcher = picomatch(filePatterns);
    const movedFiles = allFiles.filter((f) => matcher(f));
    const remainingFiles = allFiles.filter((f) => !matcher(f));

    if (movedFiles.length === 0) {
      throw new Error(`No files match the patterns: ${filePatterns.join(', ')}`);
    }

    let newBranchHead: string;
    let newSourceHead: string;

    if (!workDir) {
      await assertCleanTree(cwd);

      // Create the new branch from the merge base
      await GitShell.createBranch(cwd, newBranchName, mergeBase);

      // On the new branch: checkout matched files from the original branch, commit
      await GitShell.checkoutFiles(cwd, branch, movedFiles);
      await GitShell.add(cwd, movedFiles);
      newBranchHead = await GitShell.commit(cwd, `Split from ${branch}: ${movedFiles.length} file(s)`);

      // Back on the source branch: remove the matched files
      await GitShell.checkoutBranch(cwd, branch);

      if (remainingFiles.length === 0) {
        // All files moved — reset source to merge base
        await GitShell.resetHard(cwd, mergeBase);
      } else {
        // Files that existed at merge-base should be restored; new files should be deleted
        const mergeBaseTree = new Set(await GitShell.lsTree(cwd, mergeBase));
        const filesToRestore = movedFiles.filter((f) => mergeBaseTree.has(f));
        const filesToDelete = movedFiles.filter((f) => !mergeBaseTree.has(f));

        if (filesToRestore.length > 0) {
          await GitShell.checkoutFiles(cwd, mergeBase, filesToRestore);
          await GitShell.add(cwd, filesToRestore);
        }
        if (filesToDelete.length > 0) {
          await GitShell.rm(cwd, filesToDelete);
        }
        await GitShell.amendNoEdit(cwd);
      }

      newSourceHead = await GitShell.getBranchHead(cwd, branch);
    } else {
      const branchHead = await GitShell.getBranchHead(cwd, branch);

      // Build the new branch's single commit in the work slot.
      await GitShell.detachAt(workDir, mergeBase);
      await GitShell.checkoutFiles(workDir, branch, movedFiles);
      await GitShell.add(workDir, movedFiles);
      newBranchHead = await GitShell.commit(workDir, `Split from ${branch}: ${movedFiles.length} file(s)`);
      await GitShell.branchAt(cwd, newBranchName, newBranchHead);

      // Rewrite the source tip without the moved files, still in the slot.
      if (remainingFiles.length === 0) {
        newSourceHead = mergeBase;
      } else {
        await GitShell.detachAt(workDir, branchHead);
        const mergeBaseTree = new Set(await GitShell.lsTree(cwd, mergeBase));
        const filesToRestore = movedFiles.filter((f) => mergeBaseTree.has(f));
        const filesToDelete = movedFiles.filter((f) => !mergeBaseTree.has(f));
        if (filesToRestore.length > 0) {
          await GitShell.checkoutFiles(workDir, mergeBase, filesToRestore);
          await GitShell.add(workDir, filesToRestore);
        }
        if (filesToDelete.length > 0) {
          await GitShell.rm(workDir, filesToDelete);
        }
        await GitShell.amendNoEdit(workDir);
        newSourceHead = await GitShell.getBranchHead(workDir, 'HEAD');
      }

      const fin = await finalizeBranchRef(cwd, branch, branchHead, newSourceHead);
      await GitShell.detachAt(workDir, newSourceHead).catch(() => {});
      if (!fin.success) {
        await GitShell.deleteBranch(cwd, newBranchName).catch(() => {});
        throw new Error(fin.error ?? 'could not rewrite the source branch');
      }
    }

    // Update the stack tree: new branch is a sibling (child of the same parent)
    let updatedStack = StackManager.addNode(stack, newBranchName, parentBranch);
    updatedStack = StackManager.updateNode(updatedStack, newBranchName, {
      lastKnownHead: newBranchHead,
    });
    updatedStack = StackManager.updateNode(updatedStack, branch, {
      lastKnownHead: newSourceHead,
    });

    return {
      sourceBranch: branch,
      newBranch: newBranchName,
      movedFiles,
      remainingFiles,
      newStack: updatedStack,
    };
  },
};
