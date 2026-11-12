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
