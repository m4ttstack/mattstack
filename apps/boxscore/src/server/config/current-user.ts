import type { Forge } from '../../shared/forge.js';

export interface CurrentUser {
  username: string;
  name: string | null;
}

let cached: CurrentUser | null = null;
/** The host and token `cached` was read with; null for a user set by __setCurrentUser. */
let cachedFor: { baseUrl: string; token: string; forge: Forge } | null = null;

export function __resetCurrentUser(): void {
  cached = null;
  cachedFor = null;
}

export function __setCurrentUser(u: CurrentUser | null): void {
  cached = u;
  cachedFor = null;
}

async function readGitHubUser(
  f: typeof fetch,
  baseUrl: string,
  token: string
): Promise<CurrentUser | null> {
  try {
    const res = await f('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { login: string; name: string | null };
    cached = { username: body.login, name: body.name ?? null };
    cachedFor = { baseUrl, token, forge: 'github' };
    return cached;
  } catch {
    return null;
  }
}

/**
 * The token's own user, from GET /api/v4/user (GET /user on GitHub); SP4 swaps this to
 * provider.validateToken(). Failure is null: no row is highlighted as "you".
 */
export async function getCurrentUser(
  baseUrl: string,
  token: string,
  fetchImpl?: typeof fetch,
  forge: Forge = 'gitlab'
): Promise<CurrentUser | null> {
  if (
    cached &&
    (cachedFor === null ||
      (cachedFor.baseUrl === baseUrl &&
        cachedFor.token === token &&
        cachedFor.forge === forge))
  ) {
    return cached;
  }
  if (!fetchImpl && process.env.VITEST) return null;
  const f = fetchImpl ?? fetch;
  if (forge === 'github') return readGitHubUser(f, baseUrl, token);
  try {
    const res = await f(`${baseUrl}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      username: string;
      name: string | null;
    };
    cached = { username: body.username, name: body.name ?? null };
    cachedFor = { baseUrl, token, forge };
    return cached;
  } catch {
    return null;
  }
}
