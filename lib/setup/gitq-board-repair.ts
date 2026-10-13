import { getKnownRepos } from "../repo-index.ts";
import { parseIdentity } from "../settings/identity.ts";
import { onlyDefault } from "../settings/presence.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { repoBasename } from "./steps/repos.ts";

/** `unresolved`: a name is still bare, so the value was left as it was. `failed`: the fixed value could not be written. */
export type GitqBoardRepair = { state: "none" | "repaired" | "unresolved" } | { state: "failed"; error: unknown };

/** The registered repos by the name gitq's board would give them; a name two repos share resolves to nothing. */
function pathsByName(): Map<string, string | null> {
  const byName = new Map<string, Set<string>>();
  for (const row of getKnownRepos()) {
    const first = row.registered !== false ? row.worktrees[0] : undefined;
    if (!first) continue;
    const parsed = parseIdentity(row.repoName);
    const name = parsed ? repoBasename(parsed.id) : row.repoName;
    byName.set(name, (byName.get(name) ?? new Set()).add(first.path));
  }
  return new Map([...byName].map(([name, paths]) => [name, paths.size === 1 ? [...paths][0]! : null]));
}

/** rt setup used to seed gitq.board with bare repo names, which gitq refuses. Each gets its folder from the repo index, else from `fallback`; the value is written only when every name resolves. */
export function repairGitqBoard(fallback: (name: string) => string | null = () => null): GitqBoardRepair {
  const resolved = getSetting<{ repos?: unknown }>("gitq.board");
  const repos = resolved.value?.repos;
  if (onlyDefault(resolved) || !Array.isArray(repos) || !repos.some((r) => typeof r === "string")) return { state: "none" };
  const index = pathsByName();
  const fixed = repos.map((r) => {
    if (typeof r !== "string") return r;
    const path = index.get(r) ?? fallback(r);
    return path ? { path, name: r } : null;
  });
  if (fixed.includes(null)) return { state: "unresolved" };
  try {
    setSetting("gitq.board", { ...(resolved.value as Record<string, unknown>), repos: fixed }, "machine");
  } catch (error) {
    return { state: "failed", error };
  }
  return { state: "repaired" };
}
