/**
 * GitHub logins are case-insensitive and the metrics compare usernames
 * exactly, so every stored login takes the roster's spelling when it has one.
 * The first spelling in `known` wins, so callers list the team roster first.
 */
export function loginCanon(
  known: readonly string[]
): (login: string | null) => string | null {
  const byLower = new Map<string, string>();
  for (const k of known) {
    const lower = k.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, k);
  }
  return login =>
    login === null ? null : (byLower.get(login.toLowerCase()) ?? login);
}
