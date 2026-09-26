import type { GitWorktreeBadge, RepoStatusRow } from "../../packages/rt-client/src/commands.ts";
import type { KnownRepo } from "../repo-index.ts";

export interface UnregisteredRepo {
  identity: string;
  path: string;
}

export interface RepoListDeps {
  readCached: () => KnownRepo[];
  identityOf: (root: string) => string;
}

export function loadUnregisteredRepos(
  deps: RepoListDeps,
  registeredIdentities: Set<string>,
  current: { identity: string; path: string; registered: boolean },
): UnregisteredRepo[] {
  const seen = new Set<string>();
  const out: UnregisteredRepo[] = [];
  const add = (identity: string, path: string) => {
    if (registeredIdentities.has(identity) || seen.has(identity)) return;
    seen.add(identity);
    out.push({ identity, path });
  };
  for (const row of deps.readCached()) {
    if (row.registered !== false || row.missing) continue;
    const path = row.worktrees[0]?.path;
    if (!path) continue;
    let identity: string;
    try {
      identity = deps.identityOf(path);
    } catch {
      continue;
    }
    add(identity, path);
  }
  if (!current.registered) add(current.identity, current.path);
  return out;
}

export function mergeRepoRows(
  statusRows: RepoStatusRow[],
  unregistered: UnregisteredRepo[],
  badges: Map<string, GitWorktreeBadge>,
): RepoStatusRow[] {
  const have = new Set(statusRows.map((r) => r.repo));
  const extra: RepoStatusRow[] = unregistered
    .filter((u) => !have.has(u.identity))
    .map((u) => {
      const badge = badges.get(u.identity);
      return { repo: u.identity, worktrees: badge ? [badge] : [], error: null };
    });
  return [...statusRows, ...extra].sort((a, b) => a.repo.localeCompare(b.repo));
}
