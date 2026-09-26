/**
 * Stack Diagnostics — three-layer state evaluation.
 *
 * collectSnapshot(cwd, stack)     → async, ~30 git queries, returns serializable JSON
 * diagnoseStack(snapshot, stack)  → pure, deterministic UI contract
 */

import type { Stack, StackNode } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';

// ── Snapshot types (serializable, saved for regression testing) ───────────────

export interface BranchSnapshot {
  branch: string;
  existsOnRemote: boolean;
  /** Is parent's HEAD an ancestor of this branch? false = behind parent. */
  upToDateWithParent: boolean;
  /** For merged parents: is tombstone NOT in child's ancestry? null if N/A. */
  tombstoneDrifted: boolean | null;
  divergence: {
    state: 'identical' | 'ahead' | 'behind' | 'diverged' | 'remote-gone' | 'local-gone';
    ahead: number;
    behind: number;
  };
}

export interface StackSnapshot {
  currentBranch: string;
  /** True if the working tree has unstaged modifications (blocks rebase). */
  isDirty: boolean;
  /** True if there are staged (index) changes — e.g. from port-file. */
  hasStagedChanges: boolean;
  rebaseInProgress: boolean;
  branches: Map<string, BranchSnapshot>;
}

// ── Diagnostic output types ──────────────────────────────────────────────────

export type Situation =
  | 'synced'
  | 'local-only'
  | 'behind-parent'
  | 'parent-merged'
  | 'parent-merged-drifted'
  | 'drift'
  | 'drift-parent-merged'
  | 'local-remote-diverged'
  | 'branch-deleted-remote'
  | 'rebase-in-progress'
  | 'ci-failed'
  | 'has-threads';

export type BadgeVariant = 'positive' | 'negative' | 'merge' | 'neutral' | 'caution';
export type ActionVariant = 'primary' | 'negative' | 'neutral';

export interface NodeAction {
  id: string;
  label: string;
  variant?: ActionVariant;
}

export interface NodeDirective {
  branch: string;
  situation: Situation;
  statusLine: string;
  badge: { label: string; variant: BadgeVariant } | null;
  primaryAction: NodeAction | null;
  secondaryActions: NodeAction[];
  blocked: { reason: string } | null;
  removal: { allowed: boolean; reason?: string };
}

export type EdgeGlyph = 'alert-triangle' | 'git-merge' | 'info';

export interface EdgeDirective {
  source: string;
  target: string;
  color: string;
  dashed: boolean;
  dimmed: boolean;
  badge: {
    icon: EdgeGlyph;
    label: string;
    message: string;
    variant: 'negative' | 'merge' | 'neutral';
  } | null;
}

export type BannerDirective =
  | { kind: 'merged'; branches: string[]; canDismiss: boolean }
  | { kind: 'drift'; branches: { branch: string; parent: string }[] }
  | { kind: 'behind-trunk'; message: string }
  | { kind: 'rebase-in-progress' };

export interface StackDiagnostics {
  nodes: Map<string, NodeDirective>;
  edges: EdgeDirective[];
  banner: BannerDirective | null;
  /** Global blocks that affect all actions */
  globalBlocks: string[];
}

// ── collectSnapshot — async git state gathering ──────────────────────────────

export async function collectSnapshot(cwd: string, stack: Stack): Promise<StackSnapshot> {
  // Global state
  const [currentBranch, isDirty, hasStagedChanges] = await Promise.all([
    GitShell.getCurrentBranch(cwd).catch(() => ''),
    GitShell.isDirty(cwd).catch(() => false),
    GitShell.hasStagedChanges(cwd).catch(() => false),
  ]);

  // Check for rebase in progress
  const rebaseInProgress = GitShell.isRebaseInProgress(cwd);

  // Per-branch state — run in parallel for speed
  const branchEntries = await Promise.all(
    stack.nodes.map(async (node): Promise<[string, BranchSnapshot]> => {
      // 1. Divergence (covers existsOnRemote + ahead/behind in one call)
      const div = await GitShell.branchDivergence(cwd, node.branch).catch(() => ({
        state: 'remote-gone' as const,
        localHead: null,
        remoteHead: null,
        ahead: 0,
        behind: 0,
      }));

      // 2. Up-to-date with parent?
      let upToDateWithParent = true;
      try {
        const parentRef =
          node.parent === stack.root ? `origin/${stack.root}` : node.parent;
        const parentHead = await GitShell.getBranchHead(cwd, parentRef);
        upToDateWithParent = await GitShell.isAncestor(cwd, parentHead, node.branch);
      } catch {
        // Can't determine — assume up-to-date to avoid false positives
      }

      // 3. Tombstone drift (only for merged parents)
      let tombstoneDrifted: boolean | null = null;
      const parentNode = stack.nodes.find((n) => n.branch === node.parent);
      if (parentNode?.status === 'merged' && parentNode.lastKnownHead) {
        try {
          const isAnc = await GitShell.isAncestor(cwd, parentNode.lastKnownHead, node.branch);
          tombstoneDrifted = !isAnc;
        } catch {
          tombstoneDrifted = null;
        }
      }

      return [
        node.branch,
        {
          branch: node.branch,
          existsOnRemote: div.state !== 'remote-gone',
          upToDateWithParent,
          tombstoneDrifted,
          divergence: { state: div.state, ahead: div.ahead, behind: div.behind },
        },
      ];
    }),
  );

  return {
    currentBranch,
    isDirty,
    hasStagedChanges,
    rebaseInProgress,
    branches: new Map(branchEntries),
  };
}

// ── diagnoseStack — pure classifier ──────────────────────────────────────────

export function diagnoseStack(
  snapshot: StackSnapshot,
  stack: Stack,
  liveMrStates?: ReadonlyMap<string, string>,
): StackDiagnostics {
  const nodes = new Map<string, NodeDirective>();
  const edges: EdgeDirective[] = [];

  /**
   * Merged means stored status OR a live MR in state `merged` — the same rule
   * the board's stack-collapse predicate uses (`shapeStack` in server/data.ts).
   *
   * The stored status only learns about a merge when a reconcile runs, and a
   * node published through a failed create read-back can sit at `local-only`
   * with an iid indefinitely, so on a freshly merged branch the live state is
   * the only source that knows. Consulting stored status alone here is what
   * made a merged branch read as `Behind`: the merge advances trunk past the
   * branch, and behind-parent claims anything the merged checks decline.
   *
   * Defined once and passed down so nodes, edges and the banner cannot drift
   * apart on what counts as merged. Only `merged` upgrades — a closed-unmerged
   * MR is not a merge. An absent map (forge fetch failed) leaves every caller
   * on stored status, so this can go stale-not-merged, never spuriously merged.
   */
  const isMerged = (n: StackNode): boolean =>
    n.status === 'merged' || liveMrStates?.get(n.branch) === 'merged';

  // Global blocks
  const globalBlocks: string[] = [];
  if (snapshot.isDirty) globalBlocks.push('Working tree has uncommitted changes');
  if (snapshot.rebaseInProgress) globalBlocks.push('Rebase in progress — continue or abort first');

  // Classify each node
  for (const node of stack.nodes) {
    const bs = snapshot.branches.get(node.branch);
    nodes.set(node.branch, classifyNode(stack, node, bs ?? null, snapshot, globalBlocks, isMerged));
  }

  // Classify each edge
  for (const node of stack.nodes) {
    const bs = snapshot.branches.get(node.branch);
    edges.push(classifyEdge(stack, node, bs ?? null, nodes, isMerged));
  }

  // Classify the banner
  const banner = classifyBanner(stack, nodes, snapshot, isMerged);

  return { nodes, edges, banner, globalBlocks };
}

// ── Node classification ──────────────────────────────────────────────────────

/** Does this node count as merged: stored status or live MR state. Built once
    per diagnose in `diagnoseStack`, where the rule is documented. */
type MergedPredicate = (node: StackNode) => boolean;

function classifyNode(
  stack: Stack,
  node: StackNode,
  bs: BranchSnapshot | null,
  snapshot: StackSnapshot,
  globalBlocks: string[],
  isMerged: MergedPredicate,
): NodeDirective {
  const children = StackManager.getChildren(stack, node.branch);
  const hasChildren = children.length > 0;
  const blocked = globalBlocks.length > 0 ? { reason: globalBlocks[0]! } : null;

  // Priority order: rebase-in-progress > diverged > parent-merged > behind-parent > drift > local-only > warnings > synced

  // ── Rebase in progress (global situation applied to the current branch) ──
  if (snapshot.rebaseInProgress && snapshot.currentBranch === node.branch) {
    return {
      branch: node.branch,
      situation: 'rebase-in-progress',
      statusLine: 'Rebase in progress — resolve conflicts, then continue',
      badge: { label: 'Conflicts', variant: 'negative' },
      primaryAction: { id: 'continue-rebase', label: 'Continue Rebase', variant: 'primary' },
      secondaryActions: [{ id: 'abort-rebase', label: 'Abort Rebase', variant: 'negative' }],
      blocked: null,
      removal: { allowed: false, reason: 'Rebase in progress' },
    };
  }

  // ── Local/remote diverged (force-pushed externally) ──
  if (bs?.divergence.state === 'diverged') {
    return {
      branch: node.branch,
      situation: 'local-remote-diverged',
      statusLine: `Local and remote have diverged (${bs.divergence.ahead} ahead, ${bs.divergence.behind} behind)`,
      badge: { label: 'Diverged', variant: 'caution' },
      primaryAction: { id: 'reset-to-remote', label: 'Reset to remote', variant: 'primary' },
      secondaryActions: [{ id: 'sync-stack', label: 'Force push local', variant: 'negative' }],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Branch deleted on remote ──
  if (bs?.divergence.state === 'remote-gone' && node.status !== 'local-only') {
    // A fresh merge reads as merged, not as an alarming deletion. A
    // closed-unmerged MR with a deleted branch really is abandoned, and
    // `isMerged` declines it.
    const wasMerged = isMerged(node);
    return {
      branch: node.branch,
      situation: 'branch-deleted-remote',
      statusLine: wasMerged ? 'Merged and removed from remote' : 'Branch was deleted on remote',
      badge: { label: wasMerged ? 'Merged' : 'Deleted', variant: wasMerged ? 'merge' : 'negative' },
      primaryAction: { id: 'remove-branch', label: 'Remove from stack', variant: 'neutral' },
      secondaryActions: wasMerged ? [] : [{ id: 'sync-stack', label: 'Re-push', variant: 'primary' }],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Drift + parent merged (check BEFORE generic parent-merged) ──
  const parentNode = stack.nodes.find((n) => n.branch === node.parent);
  if (node.status === 'drift' && parentNode !== undefined && isMerged(parentNode)) {
    return {
      branch: node.branch,
      situation: 'drift-parent-merged',
      statusLine: 'MR target drifted — parent was merged',
      badge: { label: 'Needs sync', variant: 'merge' },
      primaryAction: { id: 'sync-stack', label: 'Sync Stack', variant: 'primary' },
      secondaryActions: [],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Parent merged + tombstone drifted ──
  // `tombstoneDrifted` is only ever computed for a *stored*-merged parent with
  // a `lastKnownHead` (see collectSnapshot), so a live-merged parent stays null
  // here and falls through to the plain parent-merged case below. That is the
  // correct degradation: no tombstone was recorded, so there is none to drift
  // from, and the cascade action is the same either way.
  if (parentNode !== undefined && isMerged(parentNode) && bs?.tombstoneDrifted === true) {
    return {
      branch: node.branch,
      situation: 'parent-merged-drifted',
      statusLine: 'Parent merged — needs drift reconciliation',
      badge: { label: 'Needs sync', variant: 'merge' },
      primaryAction: { id: 'cascade-merged', label: 'Sync Stack', variant: 'primary' },
      secondaryActions: [],
      blocked,
      removal: { allowed: false, reason: 'Parent merged — cascade rebase needed first' },
    };
  }

  // ── Parent merged (normal) ──
  if (parentNode !== undefined && isMerged(parentNode)) {
    return {
      branch: node.branch,
      situation: 'parent-merged',
      statusLine: 'Parent branch was merged',
      badge: { label: 'Needs sync', variant: 'merge' },
      primaryAction: { id: 'cascade-merged', label: 'Sync Stack', variant: 'primary' },
      secondaryActions: [],
      blocked,
      removal: { allowed: false, reason: 'Parent merged — cascade rebase needed first' },
    };
  }

  // ── Merged node itself (before behind-parent: the merge is what put it
  //    behind trunk in the first place) ──
  if (isMerged(node)) {
    if (hasChildren) {
      return {
        branch: node.branch,
        situation: 'parent-merged',
        statusLine: `Merged — ${children.length} child${children.length > 1 ? 'ren' : ''} need${children.length === 1 ? 's' : ''} sync`,
        badge: { label: 'Merged', variant: 'merge' },
        primaryAction: { id: 'cascade-merged', label: 'Sync Stack', variant: 'primary' },
        secondaryActions: [],
        blocked,
        removal: { allowed: false, reason: `${children.length} children need cascade rebase first` },
      };
    }
    return {
      branch: node.branch,
      situation: 'parent-merged',
      statusLine: 'Merged — safe to remove',
      badge: { label: 'Merged', variant: 'merge' },
      primaryAction: { id: 'remove-branch', label: 'Remove from stack', variant: 'neutral' },
      secondaryActions: [],
      blocked: null,
      removal: { allowed: true },
    };
  }

  // ── Behind parent (child not up-to-date) ──
  if (bs && !bs.upToDateWithParent) {
    return {
      branch: node.branch,
      situation: 'behind-parent',
      statusLine: 'Behind parent — needs rebase',
      badge: { label: 'Behind', variant: 'caution' },
      primaryAction: { id: 'sync-stack', label: 'Sync Stack', variant: 'primary' },
      secondaryActions: [],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Drift (MR target mismatch) ──
  if (node.status === 'drift') {
    return {
      branch: node.branch,
      situation: 'drift',
      statusLine: 'MR target doesn\'t match stack parent',
      badge: { label: 'Drift', variant: 'negative' },
      primaryAction: { id: 'retarget-mr', label: 'Fix MR target', variant: 'primary' },
      secondaryActions: [],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Local-only (unpublished) ──
  if (node.status === 'local-only') {
    return {
      branch: node.branch,
      situation: 'local-only',
      statusLine: 'Not published',
      badge: { label: 'Local', variant: 'neutral' },
      primaryAction: { id: 'publish-stack', label: 'Publish', variant: 'primary' },
      secondaryActions: [],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Synced with warnings ──
  if (node.pipelineStatus === 'failed') {
    return {
      branch: node.branch,
      situation: 'ci-failed',
      statusLine: 'Pipeline failed',
      badge: { label: 'CI Failed', variant: 'negative' },
      primaryAction: null,
      secondaryActions: [],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // An unknown count reaches this branch too, and says so. Falling through to
  // `synced` would render "no threads" for a number nobody managed to read.
  const threads = node.unresolvedThreads;
  if (threads === null || threads > 0) {
    return {
      branch: node.branch,
      situation: 'has-threads',
      statusLine: threads === null ? 'unresolved threads: unknown' : `${threads} unresolved thread${threads > 1 ? 's' : ''}`,
      badge: {
        label: threads === null ? 'threads?' : `${threads} thread${threads > 1 ? 's' : ''}`,
        variant: 'caution',
      },
      primaryAction: null,
      secondaryActions: [],
      blocked,
      removal: hasChildren
        ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
        : { allowed: true },
    };
  }

  // ── Synced (all good) ──
  return {
    branch: node.branch,
    situation: 'synced',
    statusLine: 'Synced',
    badge: null,
    primaryAction: null,
    secondaryActions: [],
    blocked,
    removal: hasChildren
      ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? 'es' : ''}` }
      : { allowed: true },
  };
}

// ── Edge classification ──────────────────────────────────────────────────────

function classifyEdge(
  stack: Stack,
  node: StackNode,
  bs: BranchSnapshot | null,
  nodeDirectives: Map<string, NodeDirective>,
  isMerged: MergedPredicate,
): EdgeDirective {
  const source = node.parent;
  const target = node.branch;
  const directive = nodeDirectives.get(node.branch);
  const situation = directive?.situation ?? 'synced';

  switch (situation) {
    case 'drift-parent-merged':
    case 'parent-merged':
    case 'parent-merged-drifted':
      return {
        source, target,
        color: 'var(--color-negative-high-contrast)', dashed: false, dimmed: false,
        badge: { icon: 'git-merge', label: 'Needs sync', message: 'Parent branch was merged. Use Sync Stack to update.', variant: 'merge' },
      };

    case 'drift':
      return {
        source, target,
        color: 'var(--color-negative-high-contrast)', dashed: false, dimmed: false,
        badge: { icon: 'alert-triangle', label: 'Drift', message: 'MR target doesn\'t match the stack parent.', variant: 'negative' },
      };

    case 'behind-parent':
      return {
        source, target,
        color: 'var(--color-negative-high-contrast)', dashed: false, dimmed: false,
        badge: { icon: 'alert-triangle', label: 'Behind', message: 'This branch is behind its parent. Sync Stack to update.', variant: 'negative' },
      };

    case 'local-remote-diverged':
      return {
        source, target,
        color: 'var(--color-negative-high-contrast)', dashed: false, dimmed: false,
        badge: { icon: 'alert-triangle', label: 'Diverged', message: 'Local and remote have diverged.', variant: 'negative' },
      };

    case 'local-only':
      return {
        source, target,
        color: 'var(--color-gray-40)', dashed: true, dimmed: false,
        badge: null,
      };

    default:
      // Check if THIS node itself is merged (edge to its children should be dimmed)
      if (isMerged(node)) {
        return {
          source, target,
          color: 'var(--color-gray-40)', dashed: false, dimmed: true,
          badge: { icon: 'git-merge', label: 'Merged', message: 'This branch was merged.', variant: 'merge' },
        };
      }
      return {
        source, target,
        color: 'var(--color-emphasis-high-contrast)', dashed: false, dimmed: false,
        badge: null,
      };
  }
}

// ── Banner classification ────────────────────────────────────────────────────

function classifyBanner(
  stack: Stack,
  nodeDirectives: Map<string, NodeDirective>,
  snapshot: StackSnapshot,
  isMerged: MergedPredicate,
): BannerDirective | null {
  // Rebase in progress takes priority
  if (snapshot.rebaseInProgress) {
    return { kind: 'rebase-in-progress' };
  }

  // Merged branches with children → primary action banner (non-dismissable)
  const mergedWithChildren = stack.nodes.filter(
    (n) => isMerged(n) && StackManager.getChildren(stack, n.branch).length > 0,
  );
  if (mergedWithChildren.length > 0) {
    return { kind: 'merged', branches: mergedWithChildren.map((n) => n.branch), canDismiss: false };
  }

  // Merged leaves → dismissable
  const mergedLeaves = stack.nodes.filter(
    (n) => isMerged(n) && StackManager.getChildren(stack, n.branch).length === 0,
  );
  if (mergedLeaves.length > 0) {
    return { kind: 'merged', branches: mergedLeaves.map((n) => n.branch), canDismiss: true };
  }

  // Behind trunk
  const behindNodes = Array.from(nodeDirectives.values()).filter((d) => d.situation === 'behind-parent');
  if (behindNodes.length > 0) {
    return {
      kind: 'behind-trunk',
      message: `${behindNodes.length} branch${behindNodes.length > 1 ? 'es are' : ' is'} behind — Sync Stack to update`,
    };
  }

  // Drift
  const drifted = stack.nodes.filter((n) => n.status === 'drift');
  if (drifted.length > 0) {
    return { kind: 'drift', branches: drifted.map((n) => ({ branch: n.branch, parent: n.parent })) };
  }

  return null;
}
