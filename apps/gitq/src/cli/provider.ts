import { createProvider } from '@workforge/glance-sdk';
import type { GitProvider } from '@workforge/glance-sdk';
import { resolveGitLabToken } from '../core/secrets.ts';
import { projectPathFromRemoteUrl } from '../core/forge-helpers.ts';

/**
 * GitLab provider + project path construction for the CLI.
 *
 * Ported from the old MCP helper's `resolveForgeContext`
 * (apps/gitq-mcp/src/helpers/forge-provider.ts), hardcoded to GitLab and
 * dropping the GitHub branches — this CLI only talks to GitLab. The old
 * helper resolved `baseURL` from the settings/token source (always
 * `https://gitlab.com` for GitLab, since it never derived a self-hosted host
 * from the remote URL either). Its `extractProjectPath` used to be copied here
 * verbatim, bug and all: it read the port of `ssh://host:2222/group/project`
 * as the namespace. The core parser is the one implementation now (MAT-16).
 */

const GITLAB_BASE_URL = 'https://gitlab.com';

export interface GitLabProviderContext {
  provider: GitProvider;
  projectPath: string;
}

/**
 * Build a GitLab `GitProvider` + project path from a repo's remote URL.
 *
 * Throws a `gitq: no gitlab token` error (caught by main.ts and turned into
 * a clean `fail()`) when no token is available — before any network call is
 * made, since `createProvider` itself doesn't touch the network.
 */
export function createGitLabProvider(remoteUrl: string): GitLabProviderContext {
  const token = resolveGitLabToken();
  if (!token) {
    throw new Error('no gitlab token (set GITLAB_TOKEN or add gitlabToken to ~/.rt/secrets.json)');
  }

  const provider = createProvider('gitlab', GITLAB_BASE_URL, token);
  const projectPath = extractProjectPath(remoteUrl);

  return { provider, projectPath };
}

/**
 * Extract "group/project" from a remote URL.
 *
 * SSH: "git@gitlab.com:group/project.git" -> "group/project"
 * HTTPS: "https://gitlab.com/group/project.git" -> "group/project"
 *
 * Callers here need a string to hand to the GitLab API, so a remote the core
 * parser reads no path from falls back to the remote itself, exactly as the
 * old local copy did: the request then fails naming something recognizable
 * rather than an empty path.
 */
function extractProjectPath(remoteUrl: string): string {
  return projectPathFromRemoteUrl(remoteUrl) ?? remoteUrl.replace(/\.git$/, '');
}
