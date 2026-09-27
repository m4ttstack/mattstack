// Never registers a repo: identity comes only from identityForRootReadOnly.
import type { KnownRepo } from "../repo-index.ts";
import { getKvValue, setKvValue } from "../state/kv-blob.ts";

export const LAST_REPO_NS = "glitter";
export const LAST_REPO_KEY = "lastRepo";

export interface LastRepo {
  identity: string;
  worktree: string;
}

export interface LaunchDeps {
  repoRoot: (cwd?: string) => string | null;
  identityOf: (root: string) => string;
  readLast: () => LastRepo | null;
  pathExists: (p: string) => boolean;
  pick: () => Promise<PickResult>;
}

export type PickResult = { kind: "picked"; root: string } | { kind: "cancelled" } | { kind: "no-repos" };

export type LaunchResult = { kind: "start"; repo: string; worktree: string } | { kind: "cancelled" } | { kind: "no-repos" };

export async function resolveGlitterStart(deps: LaunchDeps): Promise<LaunchResult> {
  const root = deps.repoRoot();
  if (root) return { kind: "start", repo: deps.identityOf(root), worktree: root };

  const last = deps.readLast();
  if (last && deps.pathExists(last.worktree)) {
    const lastRoot = deps.repoRoot(last.worktree);
    if (lastRoot && deps.identityOf(lastRoot) === last.identity) return { kind: "start", repo: last.identity, worktree: last.worktree };
  }

  const picked = await deps.pick();
  if (picked.kind !== "picked") return picked;
  return { kind: "start", repo: deps.identityOf(picked.root), worktree: picked.root };
}

/** The repo cache returns its rows verbatim on a hit, missing ones included, whatever includeMissing asked for. */
export function pickableRepos(repos: KnownRepo[]): KnownRepo[] {
  return repos.filter((r) => !r.missing);
}

export function readLastRepo(): LastRepo | null {
  const v = getKvValue<LastRepo | null>(LAST_REPO_NS, LAST_REPO_KEY, null);
  return v && typeof v.identity === "string" && typeof v.worktree === "string" ? v : null;
}

export function writeLastRepo(value: LastRepo): void {
  setKvValue(LAST_REPO_NS, LAST_REPO_KEY, value);
}
