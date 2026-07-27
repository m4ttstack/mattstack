import { describe, expect, test } from 'bun:test';
import { createForgeProvider } from '../src/cli/provider.ts';
import type { ForgeOverrides } from '../src/core/forges.ts';

/**
 * Every case runs offline: `createProvider` builds a client without touching
 * the network, and the token always comes from an injected env.
 */
const GITLAB_ENV = { GITLAB_TOKEN: 'glpat-test' };
const GITHUB_ENV = { GITHUB_TOKEN: 'ghp-test' };

function build(remoteUrl: string, env: Record<string, string | undefined>, overrides: ForgeOverrides = {}) {
  return createForgeProvider(remoteUrl, { env, overrides, secretsFile: '/nonexistent' });
}

describe('createForgeProvider', () => {
  describe('gitlab.com', () => {
    test('resolves the gitlab provider from an SSH remote', async () => {
      const { provider, projectPath } = await build('git@gitlab.com:acme/web.git', GITLAB_ENV);

      expect(provider.providerName).toBe('gitlab');
      expect(provider.baseURL).toBe('https://gitlab.com');
      expect(projectPath).toBe('acme/web');
    });

    test('resolves the gitlab provider from an HTTPS remote', async () => {
      const { provider, projectPath } = await build('https://gitlab.com/acme/sub/web.git', GITLAB_ENV);

      expect(provider.providerName).toBe('gitlab');
      expect(provider.baseURL).toBe('https://gitlab.com');
      // Nested groups are a GitLab feature the path parser already handles.
      expect(projectPath).toBe('acme/sub/web');
    });
  });

  describe('github.com', () => {
    test('resolves the github provider from an SSH remote', async () => {
      const { provider, projectPath } = await build('git@github.com:acme/web.git', GITHUB_ENV);

      expect(provider.providerName).toBe('github');
      expect(provider.baseURL).toBe('https://github.com');
      expect(projectPath).toBe('acme/web');
    });

    test('resolves the github provider from an HTTPS remote', async () => {
      const { provider } = await build('https://github.com/acme/web.git', GITHUB_ENV);

      expect(provider.providerName).toBe('github');
      expect(provider.baseURL).toBe('https://github.com');
    });

    test('wants a GitHub token, not a GitLab one', async () => {
      await expect(build('git@github.com:acme/web.git', GITLAB_ENV)).rejects.toThrow(
        'no github token for github.com (set GITHUB_TOKEN or add githubToken to ~/.rt/secrets.json)',
      );
    });
  });

  describe('a self-hosted host', () => {
    const overrides: ForgeOverrides = { 'gitlab.acme.com': { provider: 'gitlab' } };

    test('resolves from an override, on the instance the remote named', async () => {
      const { provider, projectPath } = await build('git@gitlab.acme.com:acme/web.git', GITLAB_ENV, overrides);

      expect(provider.providerName).toBe('gitlab');
      expect(provider.baseURL).toBe('https://gitlab.acme.com');
      expect(projectPath).toBe('acme/web');
    });

    test('resolves the same from an HTTPS remote', async () => {
      const { provider } = await build('https://gitlab.acme.com/acme/web.git', GITLAB_ENV, overrides);

      expect(provider.baseURL).toBe('https://gitlab.acme.com');
    });

    test('refuses to guess when nothing is configured for it', async () => {
      // Not a default to GitLab: an enterprise GitHub host sent down the GitLab
      // API fails somewhere a long way from the cause.
      await expect(build('git@gitlab.acme.com:acme/web.git', GITLAB_ENV)).rejects.toThrow(/gitlab\.acme\.com/);
      await expect(build('git@gitlab.acme.com:acme/web.git', GITLAB_ENV)).rejects.toThrow(/forges/);
    });

    test('takes its own token when the override names one', async () => {
      const withToken: ForgeOverrides = {
        'ghe.acme.com': { provider: 'github', tokenEnv: 'GHE_ACME_TOKEN' },
      };
      const { provider } = await build('git@ghe.acme.com:acme/web.git', { GHE_ACME_TOKEN: 'ghp-ghe' }, withToken);

      expect(provider.providerName).toBe('github');
      expect(provider.baseURL).toBe('https://ghe.acme.com');
    });

    test('names the variable it looked in when that token is missing', async () => {
      const withToken: ForgeOverrides = {
        'ghe.acme.com': { provider: 'github', tokenEnv: 'GHE_ACME_TOKEN' },
      };

      await expect(build('git@ghe.acme.com:acme/web.git', GITHUB_ENV, withToken)).rejects.toThrow(
        'no github token for ghe.acme.com (set GHE_ACME_TOKEN)',
      );
    });
  });

  test('rejects a remote that names no host at all', async () => {
    await expect(build('/srv/git/acme/web.git', GITLAB_ENV)).rejects.toThrow(/no forge host/);
  });

  test('resolves the token before anything could reach the network', async () => {
    // The token check has always come first so the error stays clean offline.
    // Provider resolution runs before it, but neither touches the network.
    await expect(build('git@gitlab.com:acme/web.git', {})).rejects.toThrow(
      'no gitlab token for gitlab.com (set GITLAB_TOKEN or add gitlabToken to ~/.rt/secrets.json)',
    );
  });
});
