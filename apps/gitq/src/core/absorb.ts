import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import type { ChangedFiles } from './git-shell.ts';
import { RebaseEngine, finalizeBranchRef } from './rebase-engine.ts';
import type { CascadeResult, RebaseResult } from './rebase-engine.ts';
import { toErrorMessage } from './error-utils.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AbsorbAttribution {
  branch: string;
  files: string[];
  success: boolean;
  error?: string;
}

export interface AbsorbResult {
  absorbed: boolean;
  reason?: 'no-changes' | 'nothing-attributable';
  attributions: AbsorbAttribution[];
  /** Files no branch's commits own. Left uncommitted in the worktree. */
  unattributed: string[];
  cascadeResult?: CascadeResult;
  updatedStack?: Stack;
}

export interface AbsorbPreview {
  /** Files confidently attributed — the branch's commits touched this file. */
  attributed: Record<string, string[]>;
  /** Files no branch's commits touched. absorb leaves these in the worktree. */
  unattributed: string[];
  /** The branch the worktree is on; where unattributed files stay dirty. */
  currentBranch: string;
}

/** The split of changed files into "a branch owns this" and "nobody does". */
export interface FileAttribution {
  /** branch → the changed files that branch's commits own. */
  byBranch: Map<string, string[]>;
  /** Changed files no branch's commits touched. */
  unattributed: string[];
}

// ── File Attribution ─────────────────────────────────────────────────────────

/**
 * Build a map of branch → set of files that branch's commits touched.
 */
async function buildBranchFileCache(
  cwd: string,
  stack: Stack,
): Promise<{ nodesReversed: ReturnType<typeof StackManager.toposort>; cache: Map<string, Set<string>> }> {
  const nodesReversed = [...StackManager.toposort(stack)].reverse();
  const cache = new Map<string, Set<string>>();
  for (const node of nodesReversed) {
    try {
      const files = await GitShell.getFilesChangedInRange(cwd, node.parent, node.branch);
      cache.set(node.branch, new Set(files));
    } catch {
      cache.set(node.branch, new Set());
    }
  }
  return { nodesReversed, cache };
}

/**
 * For each changed file, walk the stack from leaves to root (reverse topo)
 * and find the deepest branch whose commits touched that file.
 *
 * A file no branch's commits touched gets no branch: absorb has no evidence
 * about where it belongs, and the checked-out branch is a guess, not an
 * answer. Those files come back in `unattributed` and stay in the worktree.
 */
async function attributeFiles(
  cwd: string,
  stack: Stack,
  changedFiles: string[],
): Promise<FileAttribution> {
  const { nodesReversed, cache } = await buildBranchFileCache(cwd, stack);

  const byBranch = new Map<string, string[]>();
  const unattributed: string[] = [];

  for (const file of changedFiles) {
    let target: string | null = null;
    for (const node of nodesReversed) {
      const branchFiles = cache.get(node.branch);
      if (branchFiles?.has(file)) {
        target = node.branch;
        break;
      }
    }

    if (!target) {
      unattributed.push(file);
      continue;
    }

    const existing = byBranch.get(target) ?? [];
    existing.push(file);
    byBranch.set(target, existing);
  }

  return { byBranch, unattributed };
}

/**
 * Preview absorb: the same attribution `absorb` runs, with nothing committed.
 * `unattributed` is the set absorb will leave dirty in the worktree.
 */
async function previewAbsorb(cwd: string, stack: Stack): Promise<AbsorbPreview> {
  const currentBranch = await GitShell.getCurrentBranch(cwd);
  const changedResult = await GitShell.getChangedFiles(cwd);
  const allChanged = [
    ...new Set([...changedResult.modified, ...changedResult.staged, ...changedResult.untracked]),
  ];

  if (allChanged.length === 0) {
    return { attributed: {}, unattributed: [], currentBranch };
  }

  const { byBranch, unattributed } = await attributeFiles(cwd, stack, allChanged);

  return { attributed: Object.fromEntries(byBranch), unattributed, currentBranch };
}

// ── Worktree Snapshots ───────────────────────────────────────────────────────

/**
 * What the working tree held for one path, captured before the stash.
 * `deleted` is a state git reported, not one absorb inferred from a file it
 * failed to read.
 */
type EntrySnapshot =
  | { kind: 'file'; content: Buffer }
  | { kind: 'deleted' };

/** Capture one working-tree entry. */
async function snapshotEntry(cwd: string, file: string, isDeleted: boolean): Promise<EntrySnapshot> {
  const filePath = join(cwd, file);

  try {
    return { kind: 'file', content: await readFile(filePath) };
  } catch (err) {
    // Nothing there. That is the whole story only when git also says the
    // change was a deletion; otherwise the path did not survive the trip from
    // git's listing to the filesystem and absorb must not guess which.
    if (isDeleted) return { kind: 'deleted' };
    throw new Error(toErrorMessage(err));
  }
}

/**
 * Capture the working-tree entry of every changed file.
 *
 * Throws instead of skipping a file it cannot read, and does it BEFORE the
 * stash exists. Past that point `git stash push -u` takes the file out of the
 * tree and the drop at the end destroys the stash's copy, so a snapshot that
 * quietly came back empty is a file with no copy left anywhere.
 */
async function snapshotChanges(
  cwd: string,
  files: string[],
  changed: ChangedFiles,
): Promise<Map<string, EntrySnapshot>> {
  const deleted = new Set(changed.deleted ?? []);
  const entries = new Map<string, EntrySnapshot>();
  const unreadable: string[] = [];

  for (const file of files) {
    try {
      entries.set(file, await snapshotEntry(cwd, file, deleted.has(file)));
    } catch (err) {
      unreadable.push(`${file} (${toErrorMessage(err)})`);
    }
  }

  if (unreadable.length > 0) {
    throw new Error(
      `absorb refused to start: ${unreadable.length} changed file(s) could not be read, ` +
        `and stashing would leave them nowhere to come back from: ${unreadable.join('; ')}. ` +
        'Nothing was stashed, committed, or removed.',
    );
  }

  return entries;
}

/** Write one snapshotted entry back into the working tree. */
async function writeEntry(cwd: string, file: string, entry: EntrySnapshot): Promise<void> {
  const filePath = join(cwd, file);

  if (entry.kind === 'deleted') {
    await rm(filePath, { force: true });
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, entry.content);
}

/**
 * Put the files absorb refused to attribute back in the worktree. The stash
 * took the whole tree, so without this they would disappear along with the
 * changes that did get committed.
 *
 * Runs after the restack, not before: a dirty launch worktree makes the
 * cascade's ref finalization refuse (and an in-tree rebase impossible).
 */
async function restoreUnattributed(
  cwd: string,
  files: string[],
  snapshots: Map<string, EntrySnapshot>,
  wasStaged: Set<string>,
): Promise<void> {
  const restage: string[] = [];

  for (const file of files) {
    const entry = snapshots.get(file);
    if (!entry) continue;
    try {
      await writeEntry(cwd, file, entry);
      if (wasStaged.has(file)) restage.push(file);
    } catch { /* best-effort restore */ }
  }

  if (restage.length > 0) {
    await GitShell.add(cwd, restage).catch(() => {});
  }
}

// ── Absorb Orchestration ─────────────────────────────────────────────────────

/**
 * Smart Absorb: distribute uncommitted changes to the correct branches
 * in the stack based on file attribution, then restack via cascade rebase.
 *
 * Only files a branch's commits already own get committed. Anything absorb
 * cannot attribute is restored to the worktree, still uncommitted.
 *
 * After amending branches, uses a tombstone-style cascade: each child is
 * rebased using `--onto <new-parent-head> <old-parent-head> <child>` so
 * only the child's own commits are replayed.
 */
async function absorb(
  cwd: string,
  stack: Stack,
  excludedFiles?: string[],
  workDir?: string,
): Promise<AbsorbResult> {
  const currentBranch = await GitShell.getCurrentBranch(cwd);

  const changedResult = await GitShell.getChangedFiles(cwd);
  const excludeSet = new Set(excludedFiles ?? []);
  const allChanged = [
    ...new Set([...changedResult.modified, ...changedResult.staged, ...changedResult.untracked]),
  ].filter((f) => !excludeSet.has(f));

  if (allChanged.length === 0) {
    return { absorbed: false, reason: 'no-changes', attributions: [], unattributed: [] };
  }

  const { byBranch: fileMap, unattributed } = await attributeFiles(cwd, stack, allChanged);

  // Nothing the stack owns. Stashing would put the whole tree through a
  // round trip for no gain, so leave the worktree exactly as it is.
  if (fileMap.size === 0) {
    return { absorbed: false, reason: 'nothing-attributable', attributions: [], unattributed };
  }

  // Snapshot the worktree entries before stashing — avoids stash^3 issues
  // with untracked files and is more robust than git checkout stash. The
  // unattributed ones are snapshotted too, index state and all: the stash
  // takes the whole tree, so this is what puts them back afterwards.
  // Throws (before anything is stashed) if a changed file cannot be read.
  const snapshots = await snapshotChanges(cwd, allChanged, changedResult);
  const stagedBeforeAbsorb = new Set(changedResult.staged);

  // Snapshot all branch HEADs BEFORE amending — needed for tombstone cascade.
  const preAmendHeads = new Map<string, string>();
  for (const node of StackManager.toposort(stack)) {
    try {
      const head = await GitShell.getBranchHead(cwd, node.branch);
      preAmendHeads.set(node.branch, head);
    } catch { /* best-effort */ }
  }
  try {
    preAmendHeads.set(stack.root, await GitShell.getBranchHead(cwd, stack.root));
  } catch { /* best-effort */ }

  await GitShell.stash(cwd);

  const attributions: AbsorbAttribution[] = [];
  // Every key in fileMap is a stack node, so topo order covers all of them.
  const orderedBranches = StackManager.toposort(stack).map((n) => n.branch);

  let updatedStack = stack;
  let abortNeeded = false;

  for (const branch of orderedBranches) {
    const files = fileMap.get(branch);
    if (!files || files.length === 0) continue;

    try {
      await GitShell.checkoutBranch(cwd, branch);

      for (const file of files) {
        const snapshot = snapshots.get(file);
        // Same writer the restore uses, so an absorbed deletion stays one.
        if (snapshot) await writeEntry(cwd, file, snapshot);
      }

      await GitShell.add(cwd, files);
      await GitShell.amendNoEdit(cwd);

      const newHead = await GitShell.getBranchHead(cwd, branch);
      const node = StackManager.findNode(updatedStack, branch);
      if (node) {
        updatedStack = StackManager.updateNode(updatedStack, branch, {
          lastKnownHead: newHead,
        });
      }

      attributions.push({ branch, files, success: true });
    } catch (err) {
      attributions.push({ branch, files, success: false, error: toErrorMessage(err) });
      abortNeeded = true;
      break;
    }
  }

  if (abortNeeded) {
    try {
      await GitShell.checkoutBranch(cwd, currentBranch);
    } catch { /* cleanup */ }
    try {
      // Brings back everything, unattributed files included.
      await GitShell.stashPop(cwd);
    } catch { /* cleanup */ }
    return { absorbed: false, attributions, unattributed };
  }

  await GitShell.checkoutBranch(cwd, currentBranch);

  try {
    await GitShell.stashDrop(cwd);
  } catch { /* already popped or empty */ }

  const affectedBranches = new Set(attributions.filter((a) => a.success).map((a) => a.branch));
  let cascadeResult: CascadeResult | undefined;

  try {
    if (affectedBranches.size > 0) {
      cascadeResult = await cascadeAfterAbsorb(cwd, updatedStack, preAmendHeads, affectedBranches, workDir);
      if (cascadeResult) {
        updatedStack = cascadeResult.updatedStack;
      }
    }
  } finally {
    // Unconditional: a restack that blows up must not take the human's
    // unattributed work with it, since the stash holding it is already gone.
    await restoreUnattributed(cwd, unattributed, snapshots, stagedBeforeAbsorb);
  }

  const result: AbsorbResult = { absorbed: true, attributions, unattributed, updatedStack };
  if (cascadeResult) result.cascadeResult = cascadeResult;
  return result;
}

/**
 * Tombstone-style cascade after absorb: for each node whose parent was
 * amended, rebase using `--onto <parent-new-head> <parent-old-head> <branch>`.
 * This correctly replays only the node's own commits.
 */
async function cascadeAfterAbsorb(
  cwd: string,
  stack: Stack,
  preAmendHeads: Map<string, string>,
  amendedBranches: Set<string>,
  workDir?: string,
): Promise<CascadeResult> {
  const allNodes = StackManager.toposort(stack);
  let updatedStack = stack;
  const results: RebaseResult[] = [];

  for (const node of allNodes) {
    if (node.unmanaged) continue;

    const parentAmended = amendedBranches.has(node.parent);
    const selfAmended = amendedBranches.has(node.branch);

    if (!parentAmended && !selfAmended) continue;

    const oldParentHead = preAmendHeads.get(node.parent);
    if (!oldParentHead) continue;

    let newParentHead: string;
    try {
      newParentHead = await GitShell.getBranchHead(cwd, node.parent);
    } catch {
      continue;
    }

    if (oldParentHead === newParentHead) continue;

    let result: RebaseResult;
    if (workDir) {
      // Detached: replay the child's commits in the work slot and CAS the
      // ref. On conflict, back the slot out; the command layer's existing
      // "aborted the rebase, run gitq sync" protocol reports it.
      const nodeOldHead = await GitShell.getBranchHead(cwd, node.branch);
      try {
        await GitShell.detachAt(workDir, nodeOldHead);
        await GitShell.rebaseOntoDetached(workDir, newParentHead, oldParentHead);
        const newHead = await GitShell.getBranchHead(workDir, 'HEAD');
        result = await finalizeBranchRef(cwd, node.branch, nodeOldHead, newHead);
        await GitShell.detachAt(workDir, newHead).catch(() => {});
      } catch (err) {
        const message = toErrorMessage(err);
        await GitShell.rebaseAbort(workDir).catch(() => {});
        await GitShell.detachAt(workDir, 'HEAD').catch(() => {});
        result = { branch: node.branch, success: false, error: message };
      }
    } else {
      result = await RebaseEngine.rebaseSingle(cwd, newParentHead, oldParentHead, node.branch);
    }
    results.push(result);

    if (!result.success) break;

    try {
      const newHead = await GitShell.getBranchHead(cwd, node.branch);
      updatedStack = StackManager.updateNode(updatedStack, node.branch, {
        lastKnownHead: newHead,
      });
    } catch { /* best-effort */ }

    amendedBranches.add(node.branch);
  }

  return { results, updatedStack, state: 'completed' };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export const AbsorbEngine = {
  attributeFiles,
  previewAbsorb,
  absorb,
};
