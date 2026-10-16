export interface MrMapRow {
  ref: string;
  iid: number;
  title: string;
  author: string | null;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
  stacked: boolean | null;
  worktree: string | null;
  dirty: boolean | null;
  mrState: string;
  ciStatus: string | null;
}

export function joinMrsToWorktrees(
  mrs: Array<{ iid: number; title: string; author: string | null; sourceBranch: string; targetBranch: string; draft: boolean; state: string }>,
  trees: Array<{ path: string; branch: string | null }>,
  opts: { defaultBranch: string | null; ciStatus: (iid: number) => string | null },
): Omit<MrMapRow, "dirty">[] {
  // Last write wins for duplicates.
  const branchToPath = new Map<string, string>();
  for (const tree of trees) {
    if (tree.branch !== null) branchToPath.set(tree.branch, tree.path);
  }

  return mrs.map((mr) => ({
    ref: `!${mr.iid}`,
    iid: mr.iid,
    title: mr.title,
    author: mr.author,
    sourceBranch: mr.sourceBranch,
    targetBranch: mr.targetBranch,
    draft: mr.draft,
    stacked: opts.defaultBranch === null ? null : mr.targetBranch !== opts.defaultBranch,
    worktree: branchToPath.get(mr.sourceBranch) ?? null,
    mrState: mr.state,
    ciStatus: opts.ciStatus(mr.iid),
  }));
}
