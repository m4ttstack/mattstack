import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ForgeSlug } from './forges.ts';

interface ResolveOptions {
  env?: Record<string, string | undefined>;
  secretsFile?: string;
  /**
   * Env var this instance's token lives in, from its `forges` override.
   *
   * Authoritative when set: a github.com credential is not a GitHub Enterprise
   * credential, so a host that names its own variable gets that variable or
   * nothing. Falling back to the forge default would send the wrong token to an
   * instance that never issued it.
   */
  tokenEnv?: string | null;
}

const TOKEN_ENV: Record<ForgeSlug, string> = {
  gitlab: 'GITLAB_TOKEN',
  github: 'GITHUB_TOKEN',
};

/** Keys in ~/.rt/secrets.json, following the shape mr-board already writes. */
const SECRETS_KEY: Record<ForgeSlug, string> = {
  gitlab: 'gitlabToken',
  github: 'githubToken',
};

/**
 * The token for one forge: its env var, falling back to ~/.rt/secrets.json.
 *
 * Selected by provider slug rather than by a function per forge, so adding a
 * third forge is two map entries. Nothing here reaches the network, which is
 * what lets callers check for a token before deciding to make a request.
 */
export function resolveForgeToken(forge: ForgeSlug, opts: ResolveOptions = {}): string | null {
  const env = opts.env ?? process.env;
  if (opts.tokenEnv) return env[opts.tokenEnv] ?? null;

  const fromEnv = env[TOKEN_ENV[forge]];
  if (fromEnv) return fromEnv;

  const file = opts.secretsFile ?? join(homedir(), '.rt', 'secrets.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string | undefined>;
    return parsed[SECRETS_KEY[forge]] ?? null;
  } catch {
    return null;
  }
}

/** Where the caller of a failed {@link resolveForgeToken} should put the token. */
export function tokenSourceHint(forge: ForgeSlug, tokenEnv?: string | null): string {
  if (tokenEnv) return `set ${tokenEnv}`;
  return `set ${TOKEN_ENV[forge]} or add ${SECRETS_KEY[forge]} to ~/.rt/secrets.json`;
}
