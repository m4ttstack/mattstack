import type { ProjectMRStore } from "./project-mrs-store.ts";

/** GitHub logins are case-insensitive; GitLab usernames keep exact matching. */
export function authorListed(
  authors: readonly string[],
  pr: { id?: string | null; author?: { username?: string | null } | null },
): boolean {
  const username = pr.author?.username;
  if (!username) return false;
  if (!pr.id?.startsWith("github:")) return authors.includes(username);
  const lower = username.toLowerCase();
  return authors.some((a) => a.toLowerCase() === lower);
}

/**
 * An MR missing an author is kept rather than guess-dropped, and a tagged
 * stranger is kept so only the approval-heal path ever clears its tag.
 */
export function prInScope(
  rec: ProjectMRStore | undefined,
  pr: { iid: number; id?: string | null; author?: { username?: string | null } | null },
): boolean {
  const scope = rec?.scope;
  if (!scope || !pr.author?.username) return true;
  if (authorListed(scope.authors, pr)) return true;
  return (rec.mrs[pr.iid]?.codeownerSections?.length ?? 0) > 0;
}
