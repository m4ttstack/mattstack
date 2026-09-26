import { describe, expect, test } from 'bun:test';
import { resolveForge, type ForgeOverrides } from '../src/core/forges.ts';
import { hostFromRemoteUrl } from '../src/core/forge-helpers.ts';

/** The two forms every remote comes in, so each host case can be run through both. */
function remotes(host: string, path = 'acme/web'): { ssh: string; https: string } {
  return { ssh: `git@${host}:${path}.git`, https: `https://${host}/${path}.git` };
}

describe('hostFromRemoteUrl', () => {
  test('reads the host from both remote forms', () => {
    const { ssh, https } = remotes('gitlab.com');
    expect(hostFromRemoteUrl(ssh)).toBe('gitlab.com');
    expect(hostFromRemoteUrl(https)).toBe('gitlab.com');
  });

  test('reads the host from an ssh:// remote without mistaking the port for it', () => {
    expect(hostFromRemoteUrl('ssh://git@gitlab.acme.com:2222/acme/web.git')).toBe('gitlab.acme.com');
  });

  test('lowercases and strips www., so one override entry covers every spelling', () => {
    expect(hostFromRemoteUrl('https://WWW.GitHub.com/acme/web.git')).toBe('github.com');
  });

  test('keeps a single-label host, which is exactly the case that needs an override', () => {
    // `git@work:acme/web.git` names an ~/.ssh/config alias. Scope comparison
    // drops it (no MR web URL will ever carry it), but an override cannot be
    // keyed on a host that was thrown away.
    expect(hostFromRemoteUrl('git@work:acme/web.git')).toBe('work');
  });

  test('returns null for a remote that names no host', () => {
    expect(hostFromRemoteUrl('/srv/git/acme/web.git')).toBeNull();
    expect(hostFromRemoteUrl('not a url')).toBeNull();
  });
});

describe('resolveForge', () => {
  test('maps github.com to the github provider at https://github.com', () => {
    expect(resolveForge('github.com')).toEqual({
      slug: 'github',
      baseUrl: 'https://github.com',
      host: 'github.com',
      tokenEnv: null,
    });
  });

  test('maps gitlab.com to the gitlab provider at https://gitlab.com', () => {
    expect(resolveForge('gitlab.com')).toEqual({
      slug: 'gitlab',
      baseUrl: 'https://gitlab.com',
      host: 'gitlab.com',
      tokenEnv: null,
    });
  });

  test('refuses to guess an unrecognised host', () => {
    // Defaulting to gitlab would send an enterprise GitHub host down the
    // GitLab API and fail somewhere far from the cause.
    expect(resolveForge('gitlab.acme.com')).toBeNull();
    expect(resolveForge('git.acme.com')).toBeNull();
  });

  test('resolves a self-hosted host from an override, defaulting the base URL to it', () => {
    const overrides: ForgeOverrides = { 'gitlab.acme.com': { provider: 'gitlab' } };

    expect(resolveForge('gitlab.acme.com', overrides)).toEqual({
      slug: 'gitlab',
      baseUrl: 'https://gitlab.acme.com',
      host: 'gitlab.acme.com',
      tokenEnv: null,
    });
  });

  test('carries an explicit base URL and token env var from the override', () => {
    const overrides: ForgeOverrides = {
      'ghe.acme.com': { provider: 'github', baseUrl: 'https://ghe.acme.com/git', tokenEnv: 'GHE_ACME_TOKEN' },
    };

    expect(resolveForge('ghe.acme.com', overrides)).toEqual({
      slug: 'github',
      baseUrl: 'https://ghe.acme.com/git',
      host: 'ghe.acme.com',
      tokenEnv: 'GHE_ACME_TOKEN',
    });
  });

  test('lets an override redirect a known host', () => {
    const overrides: ForgeOverrides = { 'github.com': { provider: 'github', baseUrl: 'https://proxy.acme.com' } };

    expect(resolveForge('github.com', overrides)?.baseUrl).toBe('https://proxy.acme.com');
  });

  test('matches an override entry case-insensitively', () => {
    const overrides: ForgeOverrides = { 'GitLab.Acme.com': { provider: 'gitlab' } };

    expect(resolveForge('gitlab.acme.com', overrides)?.slug).toBe('gitlab');
  });

  test('resolves an ssh alias, which no built-in host list could', () => {
    const overrides: ForgeOverrides = { work: { provider: 'gitlab', baseUrl: 'https://gitlab.acme.com' } };

    expect(resolveForge('work', overrides)).toEqual({
      slug: 'gitlab',
      baseUrl: 'https://gitlab.acme.com',
      host: 'work',
      tokenEnv: null,
    });
  });

  test('rejects an override naming a forge that does not exist', () => {
    const overrides = { 'git.acme.com': { provider: 'gitlub' } } as unknown as ForgeOverrides;

    expect(() => resolveForge('git.acme.com', overrides)).toThrow(/git\.acme\.com.*gitlab.*github/s);
  });

  test('rejects an ssh-alias override that gives no base URL', () => {
    // "https://work" is not an instance. A host that is not a domain has to
    // say where the forge actually lives.
    const overrides: ForgeOverrides = { work: { provider: 'gitlab' } };

    expect(() => resolveForge('work', overrides)).toThrow(/baseUrl/);
  });
});
