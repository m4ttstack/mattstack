import { repoNameForPath, resolveForgeToken as daemonForgeToken } from '@mattstack/rt-client';
import type { RtResponse, ForgeTokenData } from '@mattstack/rt-client';
import type { ForgeSlug } from './forges.ts';

interface ResolveOptions {
  env?: Record<string, string | undefined>;
  /**
   * Env var this instance's token lives in, from its `forges` override.
   *
   * Authoritative when set: a github.com credential is not a GitHub Enterprise
   * credential, so a host that names its own variable gets that variable or
   * nothing. Falling back to the forge default would send the wrong token to an
   * instance that never issued it.
   */
  tokenEnv?: string | null;
  /**
   * Absolute path of the repo the token is for. Required for the rt-daemon
   * fallback: rt grants access per repo, so a token request that cannot name
   * its repo has nothing to be granted against.
   */
  repoPath?: string;
  /** Test seam for the daemon call. */
  daemonToken?: (repoName: string, forge: ForgeSlug) => Promise<RtResponse<ForgeTokenData>>;
}

export interface ForgeTokenResult {
  token: string | null;
  /** Why there is no token, phrased for the caller's error message. Absent when token is set. */
  reason?: string;
}

const TOKEN_ENV: Record<ForgeSlug, string> = {
  gitlab: 'GITLAB_TOKEN',
  github: 'GITHUB_TOKEN',
};

/**
 * The token for one forge: its env var, falling back to the rt daemon's
 * grant-gated secrets:forge-token verb (MAT-33).
 *
 * gitq used to open ~/.mattstack/rt/secrets.json here itself, which depended on a file
 * format rt owns and walked around rt's per-repo grant model entirely. The
 * daemon read replaces that: an untracked repo is refused, and the refusal
 * reason comes back for the caller's error message. Env vars keep precedence,
 * unchanged, and the env path stays network-free.
 */
export async function resolveForgeToken(forge: ForgeSlug, opts: ResolveOptions = {}): Promise<ForgeTokenResult> {
  const env = opts.env ?? process.env;
  if (opts.tokenEnv) {
    const token = env[opts.tokenEnv] ?? null;
    return token ? { token } : { token: null, reason: `set ${opts.tokenEnv}` };
  }

  const fromEnv = env[TOKEN_ENV[forge]];
  if (fromEnv) return { token: fromEnv };

  if (!opts.repoPath) {
    return { token: null, reason: `${tokenSourceHint(forge)}; no repo path was available for an rt lookup` };
  }
  const repoName = repoNameForPath(opts.repoPath);
  if (!repoName) {
    return {
      token: null,
      reason: `${tokenSourceHint(forge)}; ${opts.repoPath} is not registered with rt (~/.mattstack/rt/repos.json)`,
    };
  }

  const res = await (opts.daemonToken ?? daemonForgeToken)(repoName, forge);
  if (!res.ok || !res.data) {
    return { token: null, reason: res.error ?? 'rt daemon returned no token' };
  }
  return { token: res.data.token };
}

/** Where the caller of a failed {@link resolveForgeToken} should put the token. */
export function tokenSourceHint(forge: ForgeSlug, tokenEnv?: string | null): string {
  if (tokenEnv) return `set ${tokenEnv}`;
  return `set ${TOKEN_ENV[forge]} or track the repo with rt (rt daemon track <repo> live branches)`;
}
