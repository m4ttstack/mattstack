import type { Stack, StackNode, RebaseState } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { toErrorMessage } from './error-utils.ts';
import { findSlotForBranch, getWorktreeMap } from './worktrees.ts';

// ── Result types ─────────────────────────────────────────────────────────────

export interface RebaseResult {
  branch: string;
  success: boolean;
  /** Set when success is false — human-readable error message. */
  error?: string;
}

/** Captured state when a cascade pauses on a conflict. */
export interface CascadePauseInfo {
  /** Branch that hit the conflict. */
  currentBranch: string;
  /** Files with unresolved conflict markers. */
  conflictFiles: string[];
  /** Branches not yet rebased (in topo order). */
  remainingBranches: string[];
  /** Branches already rebased successfully. */
  completedBranches: string[];
  /** Non-null for tombstone-based cascade (squash merge recovery). Null for sync-based. */
  mergedBranch: string | null;
  /** The base to rebase direct children of mergedBranch onto. For sync, the root branch. */
  newBase: string;
  /** The actual `--onto` target of the branch this pause happened on. */
  currentTarget?: string;
  /**
   * Pre-rebase heads of branches this cascade already rebased, keyed by
   * branch. Lets a resumed cascade compute a child's true fork point off its
   * parent's OLD head instead of a merge-base against the rewritten one.
   */
  preRebaseHeads?: Record<string, string>;
  /** Worktree holding the paused rebase (the leased work slot). Absent for legacy cwd-anchored cascades. */
  worktreePath?: string;
  /** Tree holding a cwd-anchored (native) paused rebase: reparent's cascade and
      reconcile-phase pauses. Distinct from worktreePath on purpose: detached-flow
      CAS finalization keys off worktreePath and must not fire for native pauses. */
  treePath?: string;
  /**
   * Which phase paused. `'reconcile'` means the branch is being synced with
   * its merged parent's final state before the cascade rebase.
   * `'cascade'` (or undefined for backward compat) is the normal cascade phase.
   */
  phase?: 'reconcile' | 'cascade';
  /** Files with unresolved conflicts and their two-letter status codes. */
  conflictTypes?: { file: string; type: string }[];
  /** Current commit position in this rebase (1-indexed). */
  commitIndex?: number;
  /** Total commits being applied in this rebase. */
  commitTotal?: number;
}

export interface CascadeResult {
  /** Per-branch rebase results, in the order they were attempted. */
  results: RebaseResult[];
  /** Stack with updated `lastKnownHead` values after successful rebases. */
  updatedStack: Stack;
  /** Current state of the cascade operation. */
  state: RebaseState;
  /** Present when state is 'paused' — captures everything needed to continue or abort. */
  pauseInfo?: CascadePauseInfo;
  /** Branches that were successfully rebased and need force-pushing. */
  rebasedBranches?: string[];
}

/** A branch with unresolved MR discussion threads. */
export interface ThreadWarning {
  branch: string;
  count: number;
}

export interface ConflictPrediction {
  branch: string;
  /** Conflicted files with two-letter porcelain status codes (via normalizeMergeTreeKind). */
  files: { file: string; type: string }[];
}

export interface DriftWarning {
  branch: string;
  mergedParent: string;
}

export interface PreFlightReport {
  /** True if the working tree has any uncommitted state — untracked, staged, or unstaged (blocks rebase). */
  dirty: boolean;
  /** True if there are staged (index) changes. Informational only; `dirty` already covers this case. */
  hasStagedChanges: boolean;
  /** Branches predicted to conflict (via `git merge-tree`) with file details. */
  conflictBranches: ConflictPrediction[];
  /** Branches with unresolved MR threads — rebase may be premature. */
  threadWarnings: ThreadWarning[];
  /** Branches whose merged parent tombstone is not in their ancestry (needs reconciliation). */
  driftWarnings: DriftWarning[];
}

// ── Internal types ───────────────────────────────────────────────────────────

type OldBaseResult =
  | { kind: 'rebase'; oldBase: string }
  | { kind: 'skip' }
  | { kind: 'error'; message: string };

// ── Pre-flight ───────────────────────────────────────────────────────────────

/**
 * Normalize `git merge-tree` descriptive conflict kinds to two-letter status
 * codes (matching `git status --porcelain`) for `ConflictPrediction.files`.
 *
 * merge-tree outputs:     status --porcelain:
 *   modify/delete     →   UD  (ours modified, theirs deleted)
 *   content           →   UU  (both modified)
 *   file location     →   AU  (added by us, unmerged)
 *   add/add           →   AA  (both added)
 */
function normalizeMergeTreeKind(kind: string): string {
  switch (kind) {
    case 'modify/delete': return 'UD';
    case 'delete/modify': return 'DU';
    case 'content':       return 'UU';
    case 'file location': return 'AU';
    case 'add/add':       return 'AA';
    default:              return kind; // pass through if already a code
  }
}

/**
 * Run pre-flight checks before a rebase operation.
 *
 * 1. Check for any uncommitted state — untracked, staged, or unstaged (blocks
 *    rebase). v2 has no port-file flow, so there's no case where staged-only
 *    changes are safe to cascade through: any dirty working tree blocks it.
 * 2. Optionally dry-run conflicts via `git merge-tree` for each branch.
 */
async function preflight(cwd: string, stack: Stack, branches: string[]): Promise<PreFlightReport> {
  const dirty = await GitShell.isDirty(cwd);
  const staged = await GitShell.hasStagedChanges(cwd);
  const conflictBranches: ConflictPrediction[] = [];
  const threadWarnings: ThreadWarning[] = [];
  const driftWarnings: DriftWarning[] = [];

  for (const branch of branches) {
    const node = StackManager.findNode(stack, branch);
    if (!node) continue;

    if (node.unresolvedThreads > 0) {
      threadWarnings.push({ branch: node.branch, count: node.unresolvedThreads });
    }

    const directParent = stack.nodes.find((n) => n.branch === node.parent);
    const tombstone = directParent?.status === 'merged' ? directParent.lastKnownHead : null;

    if (tombstone) {
      const drift = await reconcileDrift(
        cwd, tombstone, branch, node.forkPoint ?? null, directParent!.branch,
      );
      if (drift.drifted) {
        driftWarnings.push({ branch, mergedParent: directParent!.branch });
      }
    }

    // Run conflict prediction unless the working tree is dirty (any
    // uncommitted state would corrupt the merge-tree result).
    if (!dirty) {
      // For branches whose parent is merged with a tombstone, use a 3-way
      // merge-tree with the tombstone as the explicit base. This accurately
      // predicts conflicts for the --onto rebase (only unique commits),
      // unlike a 2-way check which would false-positive on the
      // squash-merged parent's changes.
      const parentHead = await resolveParentHead(cwd, stack, node);
      if (!parentHead) continue;

      const conflicts = await GitShell.mergeTreeDryRun(cwd, parentHead, branch, tombstone);
      if (conflicts) {
        // Normalize merge-tree's descriptive kinds (e.g. 'modify/delete',
        // 'content', 'file location') to two-letter porcelain status codes.
        const typedConflicts = conflicts.map((c) => ({
          file: c.file,
          type: normalizeMergeTreeKind(c.kind),
        }));
        conflictBranches.push({ branch, files: typedConflicts });
      }
    }
  }

  return { dirty, hasStagedChanges: staged, conflictBranches, threadWarnings, driftWarnings };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up past merged parents to find the first non-merged ancestor branch.
 * Returns the root if all ancestors are merged.
 */
function resolveLiveAncestor(stack: Stack, branch: string): string {
  let current = branch;
  while (current !== stack.root) {
    const node = stack.nodes.find((n) => n.branch === current);
    if (!node || node.status !== 'merged') break;
    current = node.parent;
  }
  return current;
}

async function resolveParentHead(cwd: string, stack: Stack, node: StackNode): Promise<string | null> {
  try {
    const directParent = stack.nodes.find((n) => n.branch === node.parent);
    if (directParent?.status === 'merged') {
      const liveAncestor = resolveLiveAncestor(stack, node.parent);
      const effectiveRef = liveAncestor === stack.root ? `origin/${stack.root}` : liveAncestor;
      return await GitShell.getBranchHead(cwd, effectiveRef);
    }
    if (node.parent === stack.root) {
      // Sync rebases root-parented branches onto the fetched origin/<root>
      // (the local trunk is never moved), so predict against the same ref.
      try {
        return await GitShell.getBranchHead(cwd, `origin/${stack.root}`);
      } catch {
        // no remote-tracking ref: the local root is all there is
      }
    }
    return await GitShell.getBranchHead(cwd, node.parent);
  } catch {
    return null;
  }
}

// ── Drift detection ─────────────────────────────────────────────────────────

/**
 * Detect whether a merged parent's tombstone is in the child branch's
 * ancestry. If not, resolve the fork point using a 3-layer strategy:
 *
 * Layer 1: Stored `forkPoint` metadata (precise, survives rebases)
 * Layer 2: `git merge-base --fork-point` via reflog (built-in git mechanism)
 * Layer 3: `git merge-base` (works for non-rebased case, may fall back too far)
 */
async function reconcileDrift(
  cwd: string,
  tombstone: string,
  branch: string,
  storedForkPoint: string | null,
  parentRef: string | null,
): Promise<{ drifted: false } | { drifted: true; forkPoint: string }> {
  try {
    const isAnc = await GitShell.isAncestor(cwd, tombstone, branch);
    if (isAnc) return { drifted: false };

    // Layer 1: stored fork point from stack metadata
    if (storedForkPoint) {
      const valid = await validateTombstone(cwd, storedForkPoint);
      if (valid) return { drifted: true, forkPoint: storedForkPoint };
    }

    // Layer 2: reflog-based fork point detection
    if (parentRef) {
      const reflogFP = await GitShell.getMergeBaseForkPoint(cwd, parentRef, branch);
      if (reflogFP) return { drifted: true, forkPoint: reflogFP };
    }

    // Layer 3: standard merge-base (works for non-rebased parent)
    const forkPoint = await GitShell.getMergeBase(cwd, tombstone, branch);
    return { drifted: true, forkPoint };
  } catch {
    return { drifted: false };
  }
}

// ── Cherry-pick reconciliation (Layer 3 fallback) ───────────────────────────

/**
 * Last-resort reconciliation when the fork point is unknown and the
 * merge-base fell back too far (parent was rebased, changing hashes).
 *
 * Uses `git cherry` (patch-ID comparison) to identify which commits on the
 * child are unique vs duplicates of the parent's rebased commits. Cherry-picks
 * only the unique commits onto the tombstone.
 */
async function cherryPickReconcile(
  cwd: string,
  tombstone: string,
  branch: string,
  parentBranch: string,
): Promise<RebaseResult> {
  try {
    // Use reflog-based fork-point detection to find where the child actually
    // diverged from the parent. This is more reliable than git cherry (patch-ID)
    // because it works even when the parent was rebased (changing patch context).
    //
    // git merge-base --fork-point uses the parent's reflog to identify the
    // exact commit where the child branched off, regardless of subsequent
    // rebases on the parent that changed commit SHAs.
    const reflogFP = await GitShell.getMergeBaseForkPoint(cwd, parentBranch, branch);
    if (reflogFP) {
      // Only replay commits AFTER the fork point — these are the child's own work.
      return RebaseEngine.rebaseSingle(cwd, tombstone, reflogFP, branch);
    }

    // Fallback: if reflog fork-point fails (reflog expired or gc'd), try
    // git cherry to identify unique commits by patch-ID comparison.
    const entries = await GitShell.cherry(cwd, tombstone, branch);
    if (entries.length === 0) {
      return { branch, success: true };
    }

    const uniqueSHAs = entries.filter((e) => e.unique).map((e) => e.sha);

    if (uniqueSHAs.length === 0) {
      // All commits are duplicates — fast-forward to tombstone
      await GitShell.checkoutBranch(cwd, branch);
      await GitShell.resetHard(cwd, tombstone);
      return { branch, success: true };
    }

    const oldestUnique = uniqueSHAs[0]!;
    const forkForUnique = `${oldestUnique}~1`;
    return RebaseEngine.rebaseSingle(cwd, tombstone, forkForUnique, branch);
  } catch (err) {
    return { branch, success: false, error: toErrorMessage(err) };
  }
}

// ── Tombstone validation ─────────────────────────────────────────────────────

/**
 * Validate that a tombstone SHA still exists in the object database.
 * Returns the SHA if valid, null if garbage-collected or unreachable.
 */
async function validateTombstone(cwd: string, sha: string): Promise<string | null> {
  const objType = await GitShell.catFileType(cwd, sha);
  return objType ? sha : null;
}

// ── Tombstone old-base resolution ────────────────────────────────────────────

/**
 * Resolve the `oldBase` for a rebase --onto operation.
 *
 * The old base is the `lastKnownHead` of the node's parent. This is the
 * tombstone SHA that anchors where the node's unique commits begin.
 */
function resolveOldBase(stack: Stack, node: StackNode, mergedBranch: string): string | null {
  if (node.parent === mergedBranch) {
    const mergedNode = StackManager.findNode(stack, mergedBranch);
    return mergedNode?.lastKnownHead ?? null;
  }

  const parentNode = StackManager.findNode(stack, node.parent);
  return parentNode?.lastKnownHead ?? null;
}

// ── Cascade resolvers ────────────────────────────────────────────────────────

function makeTombstoneResolver(
  cwd: string,
  mergedBranch: string,
): (stack: Stack, node: StackNode) => Promise<OldBaseResult> {
  return async (stack: Stack, node: StackNode): Promise<OldBaseResult> => {
    const oldBase = resolveOldBase(stack, node, mergedBranch);
    if (!oldBase) {
      return {
        kind: 'error',
        message: `No lastKnownHead found for parent "${node.parent}" — cannot determine rebase base`,
      };
    }
    const valid = await validateTombstone(cwd, oldBase);
    if (!valid) {
      return {
        kind: 'error',
        message: `Tombstone ${oldBase.slice(0, 8)} for "${node.parent}" has been garbage-collected — cannot rebase`,
      };
    }
    return { kind: 'rebase', oldBase };
  };
}

/**
 * Old-base + parent-ref resolvers for merge-base style cascades (sync,
 * restack, and their resumes).
 *
 * When a stack-internal parent was already rebased by this cascade,
 * `preRebaseHeads` carries its pre-rebase head: the child's true fork
 * point. A plain merge-base against the parent's NEW head falls back to
 * the original base and sweeps the parent's pre-rebase commits into the
 * child's range; those normally auto-drop by patch id, but conflict
 * spuriously when conflict resolution changed the parent's content.
 */
function makeCascadeResolvers(
  cwd: string,
  stack: Stack,
  rootTarget: string,
  preRebaseHeads: Record<string, string> = {},
) {
  const resolveParentRef = (node: StackNode): string => {
    const liveAncestor = resolveLiveAncestor(stack, node.parent);
    return liveAncestor === stack.root ? rootTarget : liveAncestor;
  };

  const resolveBase = async (_stack: Stack, node: StackNode): Promise<OldBaseResult> => {
    try {
      // Check if this node's direct parent was merged with a tombstone.
      // If so, use the tombstone as the fork point — this skips the
      // merged parent's commits (squash-merge recovery).
      const parentNode = stack.nodes.find((n) => n.branch === node.parent);
      if (parentNode?.status === 'merged') {
        // Prefer live branch tip over stored lastKnownHead (may be stale)
        let tombstone: string | null = null;
        try { tombstone = await GitShell.getBranchHead(cwd, parentNode.branch); } catch {}
        if (!tombstone) tombstone = parentNode.lastKnownHead;
        if (tombstone) {
          return { kind: 'rebase', oldBase: tombstone };
        }
      }

      const parentRef = resolveParentRef(node);
      const parentHead = await GitShell.getBranchHead(cwd, parentRef);
      const oldParentHead = parentNode ? preRebaseHeads[node.parent] : undefined;
      const oldBase = oldParentHead
        ? await GitShell.getMergeBase(cwd, node.branch, oldParentHead)
        : await GitShell.getMergeBase(cwd, node.branch, parentRef);
      if (oldBase === parentHead) return { kind: 'skip' };
      return { kind: 'rebase', oldBase };
    } catch {
      return { kind: 'skip' };
    }
  };

  return { resolveParentRef, resolveBase };
}

// ── Pre-rebase redundancy detection ──────────────────────────────────────────

/**
 * Check if ALL commits on `branch` (relative to `oldBase`) are already
 * present on `targetBase` using patch-ID comparison (`git cherry`).
 *
 * When a parent was squash-merged, the child's commits that came from the
 * parent are now redundant — their changes are already on the target.
 * If EVERY commit is redundant, we can skip the rebase entirely and
 * fast-forward the branch to the target.
 *
 * Returns true only when ALL commits are redundant (safe to skip).
 * Returns false if any commit is unique (must rebase normally).
 */
async function isFullyRedundant(
  cwd: string,
  targetBase: string,
  branch: string,
): Promise<boolean> {
  try {
    const entries = await GitShell.cherry(cwd, targetBase, branch);
    if (entries.length === 0) return true;
    return entries.every((e) => !e.unique);
  } catch {
    return false;
  }
}

/**
 * Move `branch` from oldHead to newHead after a detached rebase, applying the
 * slot policy: a clean human slot sitting exactly on oldHead is re-verified
 * (TOCTOU guard), the ref CAS-moved, and the slot reset to the new head; a
 * dirty, mid-rebase, or drifted slot refuses (the detached rebase result is
 * simply discarded, which is harmless). Returns a RebaseResult.
 */
export async function finalizeBranchRef(
  cwd: string,
  branch: string,
  oldHead: string,
  newHead: string,
): Promise<RebaseResult> {
  try {
    const map = await getWorktreeMap(cwd);
    const owner = findSlotForBranch(map, branch);
    if (owner) {
      const fresh = await GitShell.isDirty(owner.path).catch(() => true);
      const stillOnOld = (await GitShell.getBranchHead(owner.path, 'HEAD')) === oldHead;
      if (fresh || owner.rebaseInProgress || !stillOnOld) {
        return {
          branch,
          success: false,
          error: `branch is checked out in slot "${owner.name}" (${owner.path}) which is ${fresh ? 'dirty' : owner.rebaseInProgress ? 'mid-rebase' : 'not on the branch head'}; commit or stash there, or free the slot, then retry`,
        };
      }
      await GitShell.updateRefCas(cwd, branch, newHead, oldHead);
      await GitShell.resetHard(owner.path, newHead);
      return { branch, success: true };
    }
    await GitShell.updateRefCas(cwd, branch, newHead, oldHead);
    return { branch, success: true };
  } catch (err) {
    return { branch, success: false, error: toErrorMessage(err) };
  }
}

// ── Shared cascade loop ──────────────────────────────────────────────────────

async function doCascadeLoop(
  cwd: string,
  initialStack: Stack,
  nodes: StackNode[],
  resolveBase: (stack: Stack, node: StackNode) => Promise<OldBaseResult>,
  resolveNewBase: (node: StackNode) => string,
  pauseContext: { mergedBranch: string | null; newBase: string },
  preRebaseHeads: Record<string, string> = {},
  workDir?: string,
): Promise<CascadeResult> {
  let updatedStack = initialStack;
  const results: RebaseResult[] = [];
  const rebasedBranches: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;

    if (node.unmanaged) continue;

    // Always resolve against the INITIAL stack so tombstone-based cascades
    // use the pre-rebase lastKnownHead values rather than mid-cascade updates.
    const baseResult = await resolveBase(initialStack, node);

    if (baseResult.kind === 'skip') {
      continue;
    }

    if (baseResult.kind === 'error') {
      results.push({ branch: node.branch, success: false, error: baseResult.message });
      break;
    }

    // Record this branch's head before anything rewrites it: descendants
    // processed later (in this loop or after a pause) use it as their true
    // fork point instead of a merge-base against the rewritten history.
    try {
      preRebaseHeads[node.branch] = await GitShell.getBranchHead(cwd, node.branch);
    } catch {
      // best-effort: descendants fall back to merge-base
    }

    // Set when a detached reconciliation ran this iteration: the slot HEAD
    // holds the reconciled commits (sitting on `base`), the branch ref has
    // not moved, and the main rebase must continue from here.
    let reconciled: { head: string; base: string } | null = null;

    // ── Drift reconciliation for merged parents ──────────────────────────
    // When the parent was squash-merged, the child needs to be reconciled
    // with the parent's final state (tombstone) BEFORE cascading to trunk.
    // This picks up review improvements the parent received after the child
    // branched. Uses reflog fork-point to replay only the child's own commits.
    const directParent = initialStack.nodes.find((n) => n.branch === node.parent);
    if (directParent?.status === 'merged') {
      // Reconciliation replays the child's own commits onto the merged
      // parent's tombstone. Natively (no workDir) it runs in `cwd`; with a
      // leased work slot it runs detached in that slot without moving the
      // branch ref, and one CAS after the main rebase finalizes both steps.
      // Resolve tombstone: prefer live branch tip over stale lastKnownHead
      let tombstone: string | null = null;
      try {
        tombstone = await GitShell.getBranchHead(cwd, directParent.branch);
      } catch {
        tombstone = directParent.lastKnownHead;
      }

      if (tombstone) {
        if (workDir) {
          // Detached reconciliation: replay the child's own commits onto the
          // tombstone in the work slot. The branch ref does not move here;
          // one CAS after the main rebase finalizes both steps.
          const startHead = preRebaseHeads[node.branch]
            ?? (await GitShell.getBranchHead(cwd, node.branch));
          const alreadyReconciled = await GitShell.isAncestor(cwd, tombstone, startHead)
            .catch(() => false);
          if (!alreadyReconciled) {
            if (await isFullyRedundant(cwd, tombstone, startHead)) {
              reconciled = { head: tombstone, base: tombstone };
            } else {
              let fp = await GitShell.getMergeBaseForkPoint(
                cwd, directParent.branch, node.branch,
              ).catch(() => null);
              if (!fp && node.forkPoint && (await validateTombstone(cwd, node.forkPoint))) {
                fp = node.forkPoint;
              }
              if (!fp) {
                fp = await GitShell.getMergeBase(cwd, tombstone, startHead).catch(() => null);
              }
              if (fp) {
                try {
                  await GitShell.detachAt(workDir, startHead);
                  await GitShell.rebaseOntoDetached(workDir, tombstone, fp);
                  reconciled = {
                    head: await GitShell.getBranchHead(workDir, 'HEAD'),
                    base: tombstone,
                  };
                } catch (err) {
                  const typedConflicts = await GitShell.listConflictedFilesWithTypes(workDir)
                    .catch(() => [] as { file: string; type: string }[]);
                  const conflictFiles = typedConflicts.length > 0
                    ? typedConflicts.map((c) => c.file)
                    : await GitShell.listConflictedFiles(workDir).catch(() => [] as string[]);
                  if (conflictFiles.length > 0) {
                    return {
                      results,
                      updatedStack,
                      state: 'paused',
                      pauseInfo: {
                        currentBranch: node.branch,
                        conflictFiles,
                        remainingBranches: nodes.slice(i + 1).map((n) => n.branch),
                        completedBranches: results.filter((r) => r.success).map((r) => r.branch),
                        mergedBranch: pauseContext.mergedBranch,
                        newBase: pauseContext.newBase,
                        currentTarget: tombstone,
                        phase: 'reconcile',
                        conflictTypes: typedConflicts,
                        preRebaseHeads: { ...preRebaseHeads },
                        worktreePath: workDir,
                      },
                    };
                  }
                  results.push({ branch: node.branch, success: false, error: toErrorMessage(err) });
                  break;
                }
              }
              // fp unresolvable (reflog gone, no stored forkPoint, merge-base
              // failed): fall through unreconciled; the main rebase still
              // lands the child on the target.
            }
          }
        } else {
          // Find child's fork point using reflogs (reliable even after parent rebase)
          const reflogFP = await GitShell.getMergeBaseForkPoint(
            cwd, directParent.branch, node.branch,
          ).catch(() => null);

          if (reflogFP) {
            // Reconcile: rebase child's own commits onto the tombstone.
            // This picks up the parent's review improvements.
            const reconResult = await RebaseEngine.rebaseSingle(
              cwd, tombstone, reflogFP, node.branch,
            );
            if (!reconResult.success) {
              const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(() => []);
              const conflictFiles = typedConflicts.length > 0
                ? typedConflicts.map((c) => c.file)
                : await GitShell.listConflictedFiles(cwd).catch(() => [] as string[]);
              if (conflictFiles.length > 0) {
                const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
                const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
                return {
                  results,
                  updatedStack,
                  state: 'paused',
                  pauseInfo: {
                    currentBranch: node.branch,
                    conflictFiles,
                    remainingBranches,
                    completedBranches,
                    mergedBranch: pauseContext.mergedBranch,
                    newBase: pauseContext.newBase,
                    currentTarget: tombstone,
                    phase: 'reconcile',
                    conflictTypes: typedConflicts,
                    preRebaseHeads: { ...preRebaseHeads },
                    treePath: cwd,
                  },
                };
              }
              results.push(reconResult);
              break;
            }
          } else {
            // Fallback: use cherry-pick reconciliation when reflogs are unavailable
            const drift = await reconcileDrift(
              cwd, tombstone, node.branch,
              node.forkPoint ?? null, directParent.branch,
            );
            if (drift.drifted) {
              const redundant = await isFullyRedundant(cwd, tombstone, node.branch);
              if (redundant) {
                await GitShell.checkoutBranch(cwd, node.branch);
                await GitShell.resetHard(cwd, tombstone);
              } else {
                const reconResult = await cherryPickReconcile(
                  cwd, tombstone, node.branch, directParent.branch,
                );
                if (!reconResult.success) {
                  const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(() => []);
                  const conflictFiles = typedConflicts.length > 0
                    ? typedConflicts.map((c) => c.file)
                    : await GitShell.listConflictedFiles(cwd).catch(() => [] as string[]);
                  if (conflictFiles.length > 0) {
                    const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
                    const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
                    return {
                      results,
                      updatedStack,
                      state: 'paused',
                      pauseInfo: {
                        currentBranch: node.branch,
                        conflictFiles,
                        remainingBranches,
                        completedBranches,
                        mergedBranch: pauseContext.mergedBranch,
                        newBase: pauseContext.newBase,
                        currentTarget: tombstone,
                        phase: 'reconcile',
                        conflictTypes: typedConflicts,
                        preRebaseHeads: { ...preRebaseHeads },
                        treePath: cwd,
                      },
                    };
                  }
                  results.push(reconResult);
                  break;
                }
              }
            }
          }
        }
      }
    }

    // ── Merged branch skip ──────────────────────────────────────────────
    // If this branch is already merged (squash-merged into trunk), skip the
    // cascade rebase entirely. Its code is already on the target via the
    // squash commit.
    //
    // IMPORTANT: do NOT move the branch pointer. The current ref IS the
    // tombstone that child branches need for drift reconciliation. Moving
    // it to master would destroy that reference and prevent children from
    // picking up review commits added after they branched.
    if (node.status === 'merged') {
      results.push({ branch: node.branch, success: true });
      continue;
    }

    // ── Main cascade rebase ──────────────────────────────────────────────
    const targetBase = resolveNewBase(node);

    // Pre-check: if ALL commits on the branch are already on the target,
    // skip the rebase — just fast-forward the branch pointer.
    const cascadeRedundant = await isFullyRedundant(cwd, targetBase, reconciled?.head ?? node.branch);
    if (cascadeRedundant) {
      if (workDir) {
        const oldHead = preRebaseHeads[node.branch];
        const targetSha = await GitShell.getBranchHead(cwd, targetBase);
        const ff = oldHead
          ? await finalizeBranchRef(cwd, node.branch, oldHead, targetSha)
          : { branch: node.branch, success: false, error: 'missing pre-rebase head for fast-forward' };
        results.push(ff);
        if (!ff.success) break;
      } else {
        await GitShell.checkoutBranch(cwd, node.branch);
        await GitShell.resetHard(cwd, targetBase);
        results.push({ branch: node.branch, success: true });
      }
    } else if (workDir) {
      // Detached flow: rebase in the work slot, then CAS-finalize the ref.
      const oldHead = preRebaseHeads[node.branch] ?? (await GitShell.getBranchHead(cwd, node.branch));
      let rebased = true;
      try {
        if (reconciled) {
          // The reconciled commits sit on the tombstone; replay exactly those.
          await GitShell.detachAt(workDir, reconciled.head);
          await GitShell.rebaseOntoDetached(workDir, targetBase, reconciled.base);
        } else {
          await GitShell.detachAt(workDir, oldHead);
          await GitShell.rebaseOntoDetached(workDir, targetBase, baseResult.oldBase);
        }
      } catch (err) {
        rebased = false;
        const typedConflicts = await GitShell.listConflictedFilesWithTypes(workDir).catch(() => []);
        const conflictFiles = typedConflicts.length > 0
          ? typedConflicts.map((c) => c.file)
          : await GitShell.listConflictedFiles(workDir).catch(() => [] as string[]);
        if (conflictFiles.length > 0) {
          const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
          const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
          return {
            results,
            updatedStack,
            state: 'paused',
            pauseInfo: {
              currentBranch: node.branch,
              conflictFiles,
              remainingBranches,
              completedBranches,
              mergedBranch: pauseContext.mergedBranch,
              newBase: pauseContext.newBase,
              currentTarget: targetBase,
              phase: 'cascade',
              conflictTypes: typedConflicts,
              preRebaseHeads: { ...preRebaseHeads },
              worktreePath: workDir,
            },
          };
        }
        results.push({ branch: node.branch, success: false, error: toErrorMessage(err) });
        break;
      }
      if (rebased) {
        const newHead = await GitShell.getBranchHead(workDir, 'HEAD');
        const fin = await finalizeBranchRef(cwd, node.branch, oldHead, newHead);
        await GitShell.detachAt(workDir, newHead).catch(() => {});
        results.push(fin);
        if (!fin.success) break;
      }
    } else {
      const result = await RebaseEngine.rebaseSingle(cwd, targetBase, baseResult.oldBase, node.branch);
      results.push(result);

      if (!result.success) {
        const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(() => []);
        const conflictFiles = typedConflicts.length > 0
          ? typedConflicts.map((c) => c.file)
          : await GitShell.listConflictedFiles(cwd).catch(() => [] as string[]);

        if (conflictFiles.length > 0) {
          const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
          const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);

          return {
            results,
            updatedStack,
            state: 'paused',
            pauseInfo: {
              currentBranch: node.branch,
              conflictFiles,
              remainingBranches,
              completedBranches,
              mergedBranch: pauseContext.mergedBranch,
              newBase: pauseContext.newBase,
              currentTarget: targetBase,
              phase: 'cascade',
              conflictTypes: typedConflicts,
              preRebaseHeads: { ...preRebaseHeads },
            },
          };
        }

        break;
      }
    }

    try {
      const newHead = await GitShell.getBranchHead(cwd, node.branch);
      updatedStack = StackManager.updateNode(updatedStack, node.branch, {
        lastKnownHead: newHead,
      });
      rebasedBranches.push(node.branch);
    } catch {
      // Non-fatal: rebased successfully but couldn't read the new HEAD
    }
  }

  return { results, updatedStack, state: 'completed', rebasedBranches };
}

// ── RebaseEngine ─────────────────────────────────────────────────────────────

/**
 * Orchestrates rebasing for stacked branches.
 *
 * All methods are stateless — they take a `Stack` and return updated results.
 * The caller is responsible for persisting the updated stack.
 */
export const RebaseEngine = {
  preflight,

  async rebaseSingle(
    cwd: string,
    newBase: string,
    oldBase: string,
    branch: string,
  ): Promise<RebaseResult> {
    try {
      await GitShell.rebaseOnto(cwd, newBase, oldBase, branch);
      return { branch, success: true };
    } catch (err) {
      return { branch, success: false, error: toErrorMessage(err) };
    }
  },

  async needsRebase(cwd: string, stack: Stack, branch: string): Promise<boolean> {
    const node = StackManager.findNode(stack, branch);
    if (!node) return false;

    try {
      const parentHead = await GitShell.getBranchHead(cwd, node.parent);
      const mergeBase = await GitShell.getMergeBase(cwd, branch, node.parent);
      return mergeBase !== parentHead;
    } catch {
      return false;
    }
  },

  /**
   * Cascade rebase: after a parent merges or changes, rebase all descendants.
   *
   * When a conflict is detected, returns `state: 'paused'` with `pauseInfo`
   * capturing the full context needed to continue or abort.
   */
  async cascadeRebase(
    cwd: string,
    stack: Stack,
    mergedBranch: string,
    newBase: string,
    workDir?: string,
  ): Promise<CascadeResult> {
    const descendants = StackManager.getDescendants(stack, mergedBranch);
    return doCascadeLoop(
      cwd,
      stack,
      descendants,
      makeTombstoneResolver(cwd, mergedBranch),
      (node) => (node.parent === mergedBranch ? newBase : node.parent),
      { mergedBranch, newBase },
      {},
      workDir,
    );
  },

  /**
   * Continue a paused cascade after the user has resolved conflicts and staged.
   *
   * Runs `git rebase --continue` on the paused branch, then cascades any
   * remaining branches.
   */
  async continueCascade(
    cwd: string,
    stack: Stack,
    pauseInfo: CascadePauseInfo,
    workDir?: string,
  ): Promise<CascadeResult> {
    const treeDir = workDir ?? pauseInfo.worktreePath ?? cwd;
    try {
      await GitShell.rebaseContinue(treeDir);
    } catch {
      const conflictFiles = await GitShell.listConflictedFiles(treeDir).catch(() => [] as string[]);
      if (conflictFiles.length > 0) {
        // Refresh conflict types with current conflict data (not stale from initial pause)
        const typedConflicts = await GitShell.listConflictedFilesWithTypes(treeDir).catch(() => [] as { file: string; type: string }[]);
        // Read rebase progress from git internals
        const progress = GitShell.getRebaseProgress(treeDir);
        return {
          results: [],
          updatedStack: stack,
          state: 'paused',
          pauseInfo: {
            ...pauseInfo,
            conflictFiles,
            conflictTypes: typedConflicts,
            commitIndex: progress?.current,
            commitTotal: progress?.total,
          },
        };
      }
      return {
        results: [
          { branch: pauseInfo.currentBranch, success: false, error: 'rebase --continue failed' },
        ],
        updatedStack: stack,
        state: 'completed',
      };
    }

    let updatedStack = stack;
    let firstResult: RebaseResult = { branch: pauseInfo.currentBranch, success: true };

    // ── Reconcile phase follow-up ────────────────────────────────────────
    // When continuing from a reconciliation pause, the child is now synced
    // with the merged parent's final state. The main cascade rebase for this
    // same branch runs now, BEFORE any ref finalization, so the detached
    // flow's single CAS covers reconcile + main rebase together.
    if (pauseInfo.phase === 'reconcile') {
      const node = StackManager.findNode(stack, pauseInfo.currentBranch);
      if (node) {
        const parentNode = StackManager.findNode(stack, node.parent);
        const tombstone = pauseInfo.currentTarget ?? parentNode?.lastKnownHead;
        if (tombstone) {
          const useTombstone = pauseInfo.mergedBranch !== null;
          // Match the loop's target resolution: a sync-origin reconcile
          // hoists onto the live ancestor (origin/<root> for root-parented
          // chains), not back onto the merged parent.
          const targetBase = useTombstone && node.parent === pauseInfo.mergedBranch
            ? pauseInfo.newBase
            : makeCascadeResolvers(cwd, stack, pauseInfo.newBase).resolveParentRef(node);

          if (pauseInfo.worktreePath) {
            // Detached: the slot HEAD holds the reconciled commits already.
            try {
              await GitShell.rebaseOntoDetached(treeDir, targetBase, tombstone);
            } catch {
              const typedConflicts = await GitShell.listConflictedFilesWithTypes(treeDir)
                .catch(() => [] as { file: string; type: string }[]);
              const conflictFiles = typedConflicts.length > 0
                ? typedConflicts.map((c) => c.file)
                : await GitShell.listConflictedFiles(treeDir).catch(() => [] as string[]);
              if (conflictFiles.length > 0) {
                const progress = GitShell.getRebaseProgress(treeDir);
                return {
                  results: [],
                  updatedStack,
                  state: 'paused',
                  pauseInfo: {
                    ...pauseInfo,
                    conflictFiles,
                    phase: 'cascade',
                    currentTarget: targetBase,
                    conflictTypes: typedConflicts,
                    commitIndex: progress?.current,
                    commitTotal: progress?.total,
                  },
                };
              }
              return {
                results: [{
                  branch: pauseInfo.currentBranch,
                  success: false,
                  error: 'main rebase failed after reconciliation',
                }],
                updatedStack: stack,
                state: 'completed',
              };
            }
          } else {
            const mainResult = await RebaseEngine.rebaseSingle(
              treeDir, targetBase, tombstone, node.branch,
            );
            if (!mainResult.success) {
              const conflictFiles = await GitShell.listConflictedFiles(treeDir).catch(() => [] as string[]);
              if (conflictFiles.length > 0) {
                const typedConflicts = await GitShell.listConflictedFilesWithTypes(treeDir)
                  .catch(() => [] as { file: string; type: string }[]);
                const progress = GitShell.getRebaseProgress(treeDir);
                return {
                  results: [firstResult],
                  updatedStack,
                  state: 'paused',
                  pauseInfo: {
                    ...pauseInfo,
                    conflictFiles,
                    phase: 'cascade',
                    currentTarget: targetBase,
                    conflictTypes: typedConflicts,
                    commitIndex: progress?.current,
                    commitTotal: progress?.total,
                  },
                };
              }
              return { results: [firstResult, mainResult], updatedStack, state: 'completed' };
            }
          }
        }
      }
    }

    // ── Detached-flow finalization ───────────────────────────────────────
    // The branch ref has not moved yet in the detached flow; finalize via
    // the same CAS + slot-policy path the main loop uses, then re-detach.
    // For reconcile pauses this runs AFTER the follow-up above, so the CAS
    // moves the ref straight from its original head to the final one.
    if (pauseInfo.worktreePath) {
      const newHead = await GitShell.getBranchHead(treeDir, 'HEAD');
      const oldHead = pauseInfo.preRebaseHeads?.[pauseInfo.currentBranch];
      if (!oldHead) {
        return {
          results: [{
            branch: pauseInfo.currentBranch,
            success: false,
            error: 'missing pre-rebase head for finalization — cannot safely move the branch ref',
          }],
          updatedStack: stack,
          state: 'completed',
        };
      }
      const fin = await finalizeBranchRef(cwd, pauseInfo.currentBranch, oldHead, newHead);
      await GitShell.detachAt(treeDir, newHead).catch(() => {});
      if (!fin.success) {
        return { results: [fin], updatedStack: stack, state: 'completed' };
      }
      firstResult = fin;
    }
    const results: RebaseResult[] = [firstResult];

    const rebasedBranches: string[] = [];

    const isNode = StackManager.findNode(stack, pauseInfo.currentBranch) !== undefined;

    if (isNode) {
      try {
        const newHead = await GitShell.getBranchHead(cwd, pauseInfo.currentBranch);
        updatedStack = StackManager.updateNode(updatedStack, pauseInfo.currentBranch, {
          lastKnownHead: newHead,
        });
        rebasedBranches.push(pauseInfo.currentBranch);
      } catch { /* best-effort HEAD update */ }
    }

    if (pauseInfo.remainingBranches.length === 0) {
      return { results, updatedStack, state: 'completed', rebasedBranches };
    }

    const remainingNodes = pauseInfo.remainingBranches
      .map((b) => StackManager.findNode(updatedStack, b))
      .filter((n): n is StackNode => n !== undefined);

    const useTombstone = pauseInfo.mergedBranch !== null;
    // Non-tombstone pauses come from sync/restack; mirror their resolvers so
    // remaining root-parented branches still target pauseInfo.newBase (for
    // sync, origin/<root>) instead of the never-moved local trunk. The
    // pre-rebase heads recorded before the pause carry the true fork points.
    const resumeHeads: Record<string, string> = { ...(pauseInfo.preRebaseHeads ?? {}) };
    const cascadeResolvers = makeCascadeResolvers(cwd, stack, pauseInfo.newBase, resumeHeads);
    const resolver = useTombstone
      ? makeTombstoneResolver(cwd, pauseInfo.mergedBranch ?? '')
      : cascadeResolvers.resolveBase;
    const newBaseResolver = useTombstone
      ? (node: StackNode) =>
          node.parent === pauseInfo.mergedBranch ? pauseInfo.newBase : node.parent
      : (node: StackNode) => cascadeResolvers.resolveParentRef(node);

    // Pass the ORIGINAL stack (before lastKnownHead updates) so tombstone
    // resolution uses pre-rebase values for deeper descendants.
    const cascadeResult = await doCascadeLoop(
      cwd,
      stack,
      remainingNodes,
      resolver,
      newBaseResolver,
      { mergedBranch: pauseInfo.mergedBranch, newBase: pauseInfo.newBase },
      resumeHeads,
      treeDir === cwd ? undefined : treeDir,
    );

    const combined: CascadeResult = {
      results: [...results, ...cascadeResult.results],
      updatedStack: cascadeResult.updatedStack,
      state: cascadeResult.state,
      rebasedBranches: [...rebasedBranches, ...(cascadeResult.rebasedBranches ?? [])],
    };
    if (cascadeResult.pauseInfo) {
      combined.pauseInfo = cascadeResult.pauseInfo;
    }
    return combined;
  },

  /** Abort a paused cascade rebase. Runs `git rebase --abort`. */
  async abortCascade(cwd: string, workDir?: string): Promise<void> {
    await GitShell.rebaseAbort(workDir ?? cwd);
  },

  /**
   * Restack descendants of a specific branch after it was amended or rebased.
   *
   * Unlike `syncLocalStack` (which fetches and restacks the whole stack onto
   * remote trunk), this only cascades the children of `branch`, using the
   * current local HEAD of `branch` as the new base. No fetch is performed.
   *
   * Useful for the "mid-stack amend" situation: user edited feat/layer-2,
   * only feat/layer-3 and feat/layer-4 need restacking.
   */
  async restackFrom(
    cwd: string,
    stack: Stack,
    branch: string,
    workDir?: string,
    seedHeads?: Record<string, string>,
  ): Promise<CascadeResult> {
    const descendants = StackManager.getDescendants(stack, branch);
    if (descendants.length === 0) {
      return { results: [], updatedStack: stack, state: 'completed' };
    }

    // Seeded heads let a caller that already rewrote `branch` (reparent's
    // own rebase, absorb's amends) hand over its pre-rewrite head, so the
    // children compute their fork point off the OLD head instead of a
    // merge-base against rewritten history.
    const preRebaseHeads: Record<string, string> = { ...(seedHeads ?? {}) };
    const { resolveBase } = makeCascadeResolvers(cwd, stack, branch, preRebaseHeads);

    return doCascadeLoop(
      cwd,
      stack,
      descendants,
      resolveBase,
      (node) => node.parent,
      { mergedBranch: null, newBase: branch },
      preRebaseHeads,
      workDir,
    );
  },


  /**
   * Sync a stack: fetch remote and rebase all stack branches onto the
   * latest remote trunk.
   *
   * GitQ manages the stack, not the trunk — the local trunk branch is
   * never modified. Stack branches rebase directly onto origin/<trunk>.
   * This avoids conflicts when trunk is checked out in another worktree.
   *
   * Uses merge-base approach (not tombstones) since this is a normal
   * pull-and-restack, not a squash-merge recovery.
   */
  async syncLocalStack(cwd: string, stack: Stack, workDir?: string): Promise<CascadeResult> {
    const trunk = stack.root;
    const remoteTrunk = `origin/${trunk}`;

    try {
      await GitShell.fetch(cwd);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch from remote: ${detail}`);
    }

    // Resolve the remote trunk HEAD — this is the rebase target for
    // top-level nodes. If the remote tracking branch doesn't exist,
    // fall back to the local trunk (nothing to sync).
    let remoteTrunkHead: string;
    try {
      remoteTrunkHead = await GitShell.getBranchHead(cwd, remoteTrunk);
    } catch {
      return { results: [], updatedStack: stack, state: 'completed' };
    }

    const preRebaseHeads: Record<string, string> = {};
    const { resolveParentRef, resolveBase } = makeCascadeResolvers(cwd, stack, remoteTrunk, preRebaseHeads);

    const allNodes = StackManager.toposort(stack);
    return doCascadeLoop(
      cwd,
      stack,
      allNodes,
      resolveBase,
      (node) => resolveParentRef(node),
      { mergedBranch: null, newBase: remoteTrunk },
      preRebaseHeads,
      workDir,
    );
  },
};
