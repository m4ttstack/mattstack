import { readFile, writeFile, mkdir, rm, lstat, readlink, symlink, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import type { ChangedFiles, IndexEntry } from './git-shell.ts';
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
 * What the working tree held for one path. A path is an ENTRY, not a byte
 * string: an untracked `deploy.sh` is 755, a `node_modules` shim is a symlink,
 * and replaying only the bytes gives the human back a different file than the
 * one absorb took away.
 */
type EntrySnapshot =
  | { kind: 'file'; content: Buffer; mode: number }
  | { kind: 'symlink'; target: string }
  | { kind: 'deleted' };

/** What the index held for one path. */
type IndexState =
  /** Index matches HEAD; the stash leaves it that way, so nothing to put back. */
  | { kind: 'unstaged' }
  /** Staged: put this exact blob back, which is what keeps `git add -p` splits split. */
  | { kind: 'blob'; entry: IndexEntry }
  /** Staged deletion: the index holds no entry for the path, and that IS the state. */
  | { kind: 'removal' }
  /** Index unreadable: re-add the working copy, the pre-existing best effort. */
  | { kind: 'restage' };

interface FileSnapshot {
  entry: EntrySnapshot;
  index: IndexState;
}

/** Capture one working-tree entry: type, mode, and content or link target. */
async function snapshotEntry(cwd: string, file: string, isDeleted: boolean): Promise<EntrySnapshot> {
  const filePath = join(cwd, file);

  let stat;
  try {
    stat = await lstat(filePath);
  } catch (err) {
    // Nothing there. That is the whole story only when git also says the
    // change was a deletion; otherwise the path did not survive the trip from
    // git's listing to the filesystem and absorb must not guess which.
    if (isDeleted) return { kind: 'deleted' };
    throw new Error(toErrorMessage(err));
  }

  if (stat.isSymbolicLink()) return { kind: 'symlink', target: await readlink(filePath) };
  return { kind: 'file', content: await readFile(filePath), mode: stat.mode & 0o7777 };
}

/**
 * Capture the working-tree entry of every changed file, plus the index state
 * of the ones absorb will have to put back itself.
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
  indexStateFor: string[],
): Promise<Map<string, FileSnapshot>> {
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

  const indexStates = await snapshotIndexStates(cwd, indexStateFor, new Set(changed.staged));

  const snapshots = new Map<string, FileSnapshot>();
  for (const [file, entry] of entries) {
    snapshots.set(file, { entry, index: indexStates.get(file) ?? { kind: 'unstaged' } });
  }
  return snapshots;
}

/** Capture what the index holds for the staged files among `files`. */
async function snapshotIndexStates(
  cwd: string,
  files: string[],
  staged: Set<string>,
): Promise<Map<string, IndexState>> {
  const states = new Map<string, IndexState>();
  const stagedFiles = files.filter((f) => staged.has(f));
  if (stagedFiles.length === 0) return states;

  // Not fatal, unlike an unreadable file: the content is already safe in
  // memory, and the fallback (re-`git add` the working copy) is what absorb
  // did for every staged file before this existed.
  let entries: Map<string, IndexEntry> | null = null;
  try {
    entries = await GitShell.getIndexEntries(cwd, stagedFiles);
  } catch { /* fall through to the re-add fallback */ }

  for (const file of stagedFiles) {
    if (!entries) {
      states.set(file, { kind: 'restage' });
      continue;
    }
    const entry = entries.get(file);
    states.set(file, entry ? { kind: 'blob', entry } : { kind: 'removal' });
  }
  return states;
}

/** Write one snapshotted entry back into the working tree, type and mode included. */
async function writeEntry(cwd: string, file: string, entry: EntrySnapshot): Promise<void> {
  const filePath = join(cwd, file);

  if (entry.kind === 'deleted') {
    await rm(filePath, { force: true });
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  // Remove first: the stash put the committed version back, and writing over
  // it would follow a symlink or keep the wrong entry type.
  await rm(filePath, { force: true });

  if (entry.kind === 'symlink') {
    await symlink(entry.target, filePath);
    return;
  }

  await writeFile(filePath, entry.content);
  await chmod(filePath, entry.mode);
}

/** Put back what the index held for one path. */
async function restoreIndexState(cwd: string, file: string, index: IndexState): Promise<void> {
  if (index.kind === 'unstaged') return;
  if (index.kind === 'restage') {
    await GitShell.add(cwd, [file]);
    return;
  }
  if (index.kind === 'removal') {
    await GitShell.removeIndexEntry(cwd, file);
    return;
  }

  try {
    await GitShell.setIndexEntry(cwd, file, index.entry);
  } catch {
    // The staged blob is unreachable (only a gc between the stash and here
    // does that). Stage the working copy instead: it collapses a partially
    // staged split, but the alternative is leaving the file unstaged.
    await GitShell.add(cwd, [file]);
  }
}

/**
 * Put the files absorb refused to attribute back in the worktree. The stash
 * took the whole tree, so without this they would disappear along with the
 * changes that did get committed.
 *
 * Runs after the restack, not before: a dirty launch worktree makes the
 * cascade's ref finalization refuse (and an in-tree rebase impossible).
 *
 * Never throws — it is called from a `finally` and must not mask the failure
 * that got it there.
 */
async function restoreUnattributed(
  cwd: string,
  files: string[],
  snapshots: Map<string, FileSnapshot>,
): Promise<{ file: string; error: string }[]> {
  const failures: { file: string; error: string }[] = [];

  for (const file of files) {
    const snapshot = snapshots.get(file);
    if (!snapshot) {
      failures.push({ file, error: 'no snapshot was taken' });
      continue;
    }
    try {
      await writeEntry(cwd, file, snapshot.entry);
      await restoreIndexState(cwd, file, snapshot.index);
    } catch (err) {
      failures.push({ file, error: toErrorMessage(err) });
    }
  }

  return failures;
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
  const snapshots = await snapshotChanges(cwd, allChanged, changedResult, unattributed);

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
        // Same writer the restore uses, so an absorbed file keeps its mode and
        // its entry type, and an absorbed deletion stays a deletion.
        if (snapshot) await writeEntry(cwd, file, snapshot.entry);
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
    await restoreUnattributed(cwd, unattributed, snapshots);
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
