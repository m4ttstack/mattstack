import { describe, expect, test } from 'bun:test';
import { resolveGitLabToken } from '../src/core/secrets.ts';

describe('resolveGitLabToken', () => {
  test('prefers the GITLAB_TOKEN env var', () => {
    expect(resolveGitLabToken({ env: { GITLAB_TOKEN: 'glpat-env' }, secretsFile: '/nonexistent' })).toBe('glpat-env');
  });

  test('falls back to gitlabToken in the secrets file', async () => {
    const dir = await import('node:fs/promises').then((fs) => fs.mkdtemp('/tmp/gitq-secrets-'));
    const path = `${dir}/secrets.json`;
    await Bun.write(path, JSON.stringify({ gitlabToken: 'glpat-file' }));
    expect(resolveGitLabToken({ env: {}, secretsFile: path })).toBe('glpat-file');
  });

  test('returns null when nothing is configured', () => {
    expect(resolveGitLabToken({ env: {}, secretsFile: '/nonexistent' })).toBeNull();
  });
});
