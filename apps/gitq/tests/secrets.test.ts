import { describe, expect, test } from 'bun:test';
import { resolveForgeToken, tokenSourceHint } from '../src/core/secrets.ts';

async function secretsFileWith(contents: Record<string, string>): Promise<string> {
  const dir = await import('node:fs/promises').then((fs) => fs.mkdtemp('/tmp/gitq-secrets-'));
  const path = `${dir}/secrets.json`;
  await Bun.write(path, JSON.stringify(contents));
  return path;
}

describe('resolveForgeToken', () => {
  test('prefers the GITLAB_TOKEN env var', () => {
    expect(resolveForgeToken('gitlab', { env: { GITLAB_TOKEN: 'glpat-env' }, secretsFile: '/nonexistent' })).toBe(
      'glpat-env',
    );
  });

  test('prefers the GITHUB_TOKEN env var', () => {
    expect(resolveForgeToken('github', { env: { GITHUB_TOKEN: 'ghp-env' }, secretsFile: '/nonexistent' })).toBe(
      'ghp-env',
    );
  });

  test('falls back to gitlabToken in the secrets file', async () => {
    const path = await secretsFileWith({ gitlabToken: 'glpat-file' });
    expect(resolveForgeToken('gitlab', { env: {}, secretsFile: path })).toBe('glpat-file');
  });

  test('falls back to githubToken in the secrets file', async () => {
    const path = await secretsFileWith({ githubToken: 'ghp-file' });
    expect(resolveForgeToken('github', { env: {}, secretsFile: path })).toBe('ghp-file');
  });

  test('never hands one forge the other forge credential', async () => {
    const path = await secretsFileWith({ gitlabToken: 'glpat-file' });

    expect(resolveForgeToken('github', { env: { GITLAB_TOKEN: 'glpat-env' }, secretsFile: path })).toBeNull();
  });

  test('returns null when nothing is configured', () => {
    expect(resolveForgeToken('gitlab', { env: {}, secretsFile: '/nonexistent' })).toBeNull();
  });

  describe('a host with its own token env var', () => {
    test('reads the named variable', () => {
      expect(resolveForgeToken('github', { env: { GHE_ACME_TOKEN: 'ghp-ghe' }, tokenEnv: 'GHE_ACME_TOKEN' })).toBe(
        'ghp-ghe',
      );
    });

    test('does not fall back to the forge default when it is unset', async () => {
      // Falling through would send a github.com credential to an enterprise
      // instance that never issued it. Naming a variable means that variable.
      const path = await secretsFileWith({ githubToken: 'ghp-file' });

      expect(
        resolveForgeToken('github', { env: { GITHUB_TOKEN: 'ghp-dotcom' }, secretsFile: path, tokenEnv: 'GHE_ACME_TOKEN' }),
      ).toBeNull();
    });
  });
});

describe('tokenSourceHint', () => {
  test('names the forge-specific env var and secrets key', () => {
    expect(tokenSourceHint('github')).toBe('set GITHUB_TOKEN or add githubToken to ~/.rt/secrets.json');
    expect(tokenSourceHint('gitlab')).toBe('set GITLAB_TOKEN or add gitlabToken to ~/.rt/secrets.json');
  });

  test('names only the configured variable when a host has one', () => {
    expect(tokenSourceHint('github', 'GHE_ACME_TOKEN')).toBe('set GHE_ACME_TOKEN');
  });
});
