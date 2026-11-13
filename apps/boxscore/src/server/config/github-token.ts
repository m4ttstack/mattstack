import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  resolveForgeToken,
  serializeIdentity,
  type ForgeTokenData,
  type RtResponse,
} from '@mattstack/rt-client';

export interface GitHubTokenDeps {
  env?: Record<string, string | undefined>;
  forgeToken?: (repoName: string) => Promise<RtResponse<ForgeTokenData>>;
}

export type GitHubTokenResult =
  { token: string } | { token: null; reason: string };

let injected: GitHubTokenDeps | null = null;

export function __setGitHubTokenDeps(d: GitHubTokenDeps | null): void {
  injected = d;
}

/** The rt repo identity the daemon grants a github.com project's token against. */
export function githubRepoName(projectPath: string): string {
  return serializeIdentity({
    kind: 'remote',
    id: `github.com/${projectPath}`,
  });
}

function defaultForgeToken(
  repoName: string
): Promise<RtResponse<ForgeTokenData>> {
  // HOME is read at call time so a changed HOME is honored.
  const sockPath = join(
    process.env.HOME ?? homedir(),
    '.mattstack',
    'rt',
    'rt.sock'
  );
  return resolveForgeToken(repoName, 'github', { sockPath });
}

/** GITHUB_TOKEN, else the daemon's grant for the first configured project that has one. */
export async function readGitHubToken(
  projects: readonly string[],
  deps: GitHubTokenDeps = injected ?? {}
): Promise<GitHubTokenResult> {
  const env = deps.env ?? process.env;
  const fromEnv = env.GITHUB_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv };

  if (projects.length === 0) {
    return {
      token: null,
      reason: 'boxscore.projects is empty, so no repo can grant a token',
    };
  }
  if (!deps.forgeToken && process.env.VITEST) {
    return { token: null, reason: 'tests must inject forgeToken' };
  }
  const forgeToken = deps.forgeToken ?? defaultForgeToken;

  let firstRefusal: string | null = null;
  for (const project of projects) {
    const res = await forgeToken(githubRepoName(project));
    if (res.ok && res.data?.token) return { token: res.data.token };
    firstRefusal ??= res.error ?? 'rt daemon returned no token';
  }
  return { token: null, reason: firstRefusal ?? 'rt daemon returned no token' };
}
