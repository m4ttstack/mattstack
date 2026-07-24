// ── Edge / Node sync states ──────────────────────────────────────────────────

/** How a stack node's local state relates to the forge. */
export type StackNodeStatus = 'local-only' | 'synced' | 'drift' | 'merged';

/** Pipeline status as fetched from the forge. */
export type PipelineStatus = 'success' | 'failed' | 'running' | 'pending' | 'unknown';

// ── Rebase state machine ─────────────────────────────────────────────────────

/** State of a cascade rebase operation. */
export type RebaseState = 'idle' | 'paused' | 'aborted' | 'completed';

// ── Diff stats ───────────────────────────────────────────────────────────────

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

// ── Stack node ───────────────────────────────────────────────────────────────

export interface StackNode {
  /** Git branch name. Unique within a stack. */
  branch: string;

  /** Branch name of the parent node. Root nodes use the stack's root (e.g. "main"). */
  parent: string;

  /** Forge MR/PR IID. Null if no MR exists yet. */
  mrIid: number | null;

  /** MR web URL for deep-linking into the forge. */
  mrUrl: string | null;

  /** MR/PR title from the forge. Null if no MR exists yet. */
  mrTitle: string | null;

  /** Sync state between local config and the forge. */
  status: StackNodeStatus;

  /**
   * Tombstone SHA — the commit SHA of this branch's HEAD at a known-good point.
   * Used as the `<upstream>` argument in `git rebase --onto` after a parent squash-merges.
   */
  lastKnownHead: string | null;

  /**
   * The parent's HEAD SHA at the time this branch was created.
   * Used as the precise oldBase for reconciliation when the parent
   * was rebased or squash-merged. Null for legacy nodes.
   */
  forkPoint: string | null;

  /** Diff stats relative to parent HEAD. Populated from forge or local git. */
  diffStats: DiffStats | null;

  /** Latest CI pipeline status. */
  pipelineStatus: PipelineStatus;

  /** Number of unresolved discussion threads on the MR. */
  unresolvedThreads: number;

  /** When true, this node is context-only: visible in the graph but skipped during cascade rebase. */
  unmanaged?: boolean;
}

// ── Stack (the tree) ─────────────────────────────────────────────────────────

export interface Stack {
  /** Opaque unique identifier (UUID). Never shown to the user. */
  id: string;

  /** User-provided display name. Always set at creation time. */
  stackName: string;

  /** The root branch that this stack grows from (e.g. "main", "develop"). */
  root: string;

  /** All nodes in the stack. The root branch is NOT included as a node. */
  nodes: StackNode[];
}

// ── Persistence format ───────────────────────────────────────────────────────

export interface StackStore {
  /** Absolute path to the git repo root. */
  repoPath: string;

  /** Remote URL (e.g. "git@github.com:user/repo.git"). */
  remoteUrl: string;

  /** All stacks for this repo. */
  stacks: Stack[];
}
