// Never registers a repo: identity comes only from identityForRootReadOnly.
import { getKvValue, setKvValue } from "../state/kv-blob.ts";

export const LAST_REPO_NS = "glitter";
export const LAST_REPO_KEY = "lastRepo";

export interface LastRepo {
  identity: string;
  worktree: string;
}

export interface LaunchDeps {
  repoRoot: () => string | null;
  identityOf: (root: string) => string;
  readLast: () => LastRepo | null;
  pathExists: (p: string) => boolean;
  pick: () => Promise<string | null>;
}

export type LaunchResult = { kind: "start"; repo: string; worktree: string } | { kind: "cancelled" };

export async function resolveGlitterStart(deps: LaunchDeps): Promise<LaunchResult> {
  const root = deps.repoRoot();
  if (root) return { kind: "start", repo: deps.identityOf(root), worktree: root };

  const last = deps.readLast();
  if (last && deps.pathExists(last.worktree)) return { kind: "start", repo: last.identity, worktree: last.worktree };

  const picked = await deps.pick();
  if (!picked) return { kind: "cancelled" };
  return { kind: "start", repo: deps.identityOf(picked), worktree: picked };
}

export function readLastRepo(): LastRepo | null {
  const v = getKvValue<LastRepo | null>(LAST_REPO_NS, LAST_REPO_KEY, null);
  return v && typeof v.identity === "string" && typeof v.worktree === "string" ? v : null;
}

export function writeLastRepo(value: LastRepo): void {
  setKvValue(LAST_REPO_NS, LAST_REPO_KEY, value);
}
