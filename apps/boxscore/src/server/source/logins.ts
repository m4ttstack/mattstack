/**
 * GitHub logins are case-insensitive and the metrics compare usernames
 * exactly, so every stored login takes the roster's spelling when it has one.
 */
export function loginCanon(
  known: readonly string[]
): (login: string | null) => string | null {
  const byLower = new Map(known.map(k => [k.toLowerCase(), k]));
  return login =>
    login === null ? null : (byLower.get(login.toLowerCase()) ?? login);
}
