import { createProvider } from '@workforge/glance-sdk';
import type { GitProvider } from '@workforge/glance-sdk';
import { resolveForgeToken, tokenSourceHint } from '../core/secrets.ts';
import { readForgeOverrides, resolveForge, type ForgeOverrides } from '../core/forges.ts';
import { hostFromRemoteUrl, projectPathFromRemoteUrl } from '../core/forge-helpers.ts';
import { getSettingsFilePath } from '../core/config-paths.ts';

/**
 * Forge provider + project path construction for the CLI.
 *
 * Ported from the old MCP helper's `resolveForgeContext`
 * (apps/gitq-mcp/src/helpers/forge-provider.ts). That helper resolved `baseURL`
 * from the settings/token source, and this CLI replaced it with a
 * `https://gitlab.com` constant — which made gitq not merely GitLab-only but
 * gitlab.com-only, since the base URL the SDK accepts was discarded. Both now
 * come off the remote's host (MAT-16), so self-hosted instances of either forge
 * work without a code change.
 *
 * Its `extractProjectPath` used to be copied here verbatim, bug and all: it read
 * the port of `ssh://host:2222/group/project` as the namespace. The core parser
 * is the one implementation now.
 */

export interface ForgeProviderContext {
  provider: GitProvider;
  projectPath: string;
}

export interface ForgeProviderOptions {
  /** Host → forge map. Read from settings.json when not injected. */
  overrides?: ForgeOverrides;
  env?: Record<string, string | undefined>;
  secretsFile?: string;
}

/**
 * Build a `GitProvider` + project path from a repo's remote URL.
 *
 * Throws (caught by main.ts and turned into a clean `fail()`) when the remote
 * names no host, when no forge can be identified for that host, or when no
 * token is available — all before any network call, since neither resolution
 * step nor `createProvider` itself touches the network.
 */
export async function createForgeProvider(
  remoteUrl: string,
  opts: ForgeProviderOptions = {},
): Promise<ForgeProviderContext> {
  const host = hostFromRemoteUrl(remoteUrl);
  if (!host) {
    throw new Error(
      `no forge host in remote "${remoteUrl}"; gitq reads the forge from the remote's host, so this repo needs one that names an instance`,
    );
  }

  const forge = resolveForge(host, opts.overrides ?? (await readForgeOverrides()));
  if (!forge) {
    throw new Error(
      `cannot tell which forge "${host}" is (from remote ${remoteUrl}); name it in ${getSettingsFilePath()} as {"forges": {"${host}": {"provider": "gitlab"}}}`,
    );
  }

  const token = resolveForgeToken(forge.slug, {
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.secretsFile ? { secretsFile: opts.secretsFile } : {}),
    tokenEnv: forge.tokenEnv,
  });
  if (!token) {
    throw new Error(`no ${forge.slug} token for ${forge.host} (${tokenSourceHint(forge.slug, forge.tokenEnv)})`);
  }

  return { provider: createProvider(forge.slug, forge.baseUrl, token), projectPath: extractProjectPath(remoteUrl) };
}

/**
 * Extract "group/project" from a remote URL.
 *
 * SSH: "git@gitlab.com:group/project.git" -> "group/project"
 * HTTPS: "https://gitlab.com/group/project.git" -> "group/project"
 *
 * Callers here need a string to hand to the forge API, so a remote the core
 * parser reads no path from falls back to the remote itself, exactly as the
 * old local copy did: the request then fails naming something recognizable
 * rather than an empty path.
 */
function extractProjectPath(remoteUrl: string): string {
  return projectPathFromRemoteUrl(remoteUrl) ?? remoteUrl.replace(/\.git$/, '');
}
