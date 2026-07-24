import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { assertCleanTree } from './git-guards.ts';
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
 * The operation is:
 * 1. Check dirty tree (refuse if uncommitted changes)
 * 2. Create a new branch at Source HEAD (preserves all commits)
 * 3. Reset source branch to splitAfterSha
 * 4. Add new branch as child of source in the stack tree
 * 5. Update lastKnownHead on both branches
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
   * @param splitAfterSha  - Commit SHA to split after (commits after this move to new branch).
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

    await assertCleanTree(cwd);

    // Get the commits that will be moved (everything after splitAfterSha)
    const commits = await BranchSplitter.getCommitLog(cwd, sourceBranch);
    const splitIdx = commits.findIndex((c) => c.sha === splitAfterSha);
    if (splitIdx === -1) {
      throw new Error(`Commit "${splitAfterSha}" not found in branch "${sourceBranch}"`);
    }

    // Commits before and at the split point stay on source.
    // Commits after the split point (newer = earlier in log) move to new branch.
    const movedCommits = commits.slice(0, splitIdx).map((c) => c.sha);

    if (movedCommits.length === 0) {
      throw new Error('No commits to split — the split point is already at HEAD');
    }

    // Record source HEAD before any mutations
    const sourceHead = await GitShell.getBranchHead(cwd, sourceBranch);

    // Step 1: Create new branch at source's current HEAD (preserves all commits)
    await GitShell.checkoutBranch(cwd, sourceBranch);
    await GitShell.createBranch(cwd, newBranchName, sourceHead);

    // Step 2: Reset source branch to the split point
    await GitShell.checkoutBranch(cwd, sourceBranch);
    await GitShell.resetHard(cwd, splitAfterSha);

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
   */
  async splitByFile(
    cwd: string,
    stack: Stack,
    branch: string,
    filePatterns: string[],
    newBranchName: string,
  ): Promise<SplitByFileResult> {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new Error(`Branch "${branch}" not found in stack "${stack.id}"`);
    }

    if (StackManager.findNode(stack, newBranchName) || newBranchName === stack.root) {
      throw new Error(`Branch "${newBranchName}" already exists in stack "${stack.id}"`);
    }

    await assertCleanTree(cwd);

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

    // Create the new branch from the merge base
    await GitShell.createBranch(cwd, newBranchName, mergeBase);

    // On the new branch: checkout matched files from the original branch, commit
    await GitShell.checkoutFiles(cwd, branch, movedFiles);
    await GitShell.add(cwd, movedFiles);
    const newBranchHead = await GitShell.commit(cwd, `Split from ${branch}: ${movedFiles.length} file(s)`);

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

    const newSourceHead = await GitShell.getBranchHead(cwd, branch);

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
