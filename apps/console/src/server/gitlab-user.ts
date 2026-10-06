import { getSetting, readGitlabToken } from '@mattstack/rt-client';

export interface GitlabUserDeps {
  /** The user-confirmed forge host: the only host a token may be sent to. */
  host: () => string | undefined;
  token: () => Promise<string | null>;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
}

const realDeps: GitlabUserDeps = {
  host: () =>
    getSetting<{ forgeHost?: string } | undefined>('rt.integrations').value
      ?.forgeHost,
  token: () => readGitlabToken(),
  fetch: (input, init) => fetch(input, init),
};

let cached: string | null = null;

export function __resetGitlabUsername(): void {
  cached = null;
}

/** The GitLab username behind this Mac's token, or null on any failure. */
export async function gitlabUsername(
  deps?: GitlabUserDeps
): Promise<string | null> {
  if (cached) return cached;
  if (!deps && process.env.VITEST) return null;
  const d = deps ?? realDeps;
  try {
    const host = d.host();
    if (!host) return null;
    const token = await d.token();
    if (!token) return null;
    const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
    const res = await d.fetch(`${base.replace(/\/+$/, '')}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': token },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { username?: unknown };
    if (typeof body.username !== 'string') return null;
    cached = body.username;
    return cached;
  } catch {
    return null;
  }
}
