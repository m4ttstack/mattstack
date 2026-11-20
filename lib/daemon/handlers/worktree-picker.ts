/**
 * `worktrees:picker` — rt cd's worktree order for clients that cannot run it
 * themselves (the VS Code extension cannot open state.db, which holds the
 * tree records the recency groups read).
 */

import { getKnownReposAsync, repoCarriesWorktree, type KnownRepo } from "../../repo-index.ts";
import { pickerOrder, type RecencyGroup } from "../../worktree-groups.ts";
import type { CommandResult } from "./types.ts";

export interface WorktreePickerDeps {
  knownRepos: () => Promise<KnownRepo[]>;
  order: typeof pickerOrder;
}

const defaultDeps: WorktreePickerDeps = { knownRepos: () => getKnownReposAsync(), order: pickerOrder };

export function createWorktreePickerHandlers(
  deps: WorktreePickerDeps = defaultDeps,
): { "worktrees:picker": (payload: unknown) => Promise<CommandResult<"worktrees:picker">> } {
  return {
    "worktrees:picker": async (payload) => {
      const path = (payload as { path?: unknown } | null)?.path;
      if (typeof path !== "string" || path.length === 0) return { ok: false, error: "path-required" };
      const repo = (await deps.knownRepos()).find((r) => repoCarriesWorktree(r, path));
      if (!repo) return { ok: false, error: "repo-unknown" };
      const { worktrees, groupOf } = deps.order(repo);
      const trees = worktrees.map((wt) => ({
        path: wt.path,
        branch: wt.branch || null,
        group: (groupOf.get(wt.path) ?? null) as RecencyGroup | null,
      }));
      return { ok: true, data: { repoName: repo.repoName, trees } };
    },
  };
}
