import { describe, expect, test } from 'bun:test';
import { resolveForgeToken, tokenSourceHint } from '../src/core/secrets.ts';

/**
 * Token resolution after MAT-33: env vars first, then the rt daemon's
 * grant-gated secrets:forge-token verb through the `daemonToken` seam. The
 * old ~/.mattstack/rt/secrets.json file read is gone; nothing here touches disk.
 */

const refuse = async () => ({ ok: false, error: 'repo gitq is not tracked by rt; run: rt daemon track gitq live branches' });
const grant = (token: string) => async () => ({ ok: true, data: { token } });
const explode = async () => {
  throw new Error('daemon must not be consulted');
};

describe('resolveForgeToken', () => {
  test('env var wins for gitlab and the daemon is never consulted', async () => {
    const res = await resolveForgeToken('gitlab', {
      env: { GITLAB_TOKEN: 'glpat-env' },
      repoPath: '/repo',
      daemonToken: explode as never,
    });
    expect(res).toEqual({ token: 'glpat-env' });
  });

  test('env var wins for github', async () => {
    const res = await resolveForgeToken('github', {
      env: { GITHUB_TOKEN: 'ghp-env' },
      repoPath: '/repo',
      daemonToken: explode as never,
    });
    expect(res).toEqual({ token: 'ghp-env' });
  });

  test('a granted repo gets the daemon token when env misses', async () => {
    const res = await resolveForgeToken('gitlab', {
      env: {},
      repoPath: '/Users/matt/Documents/GitHub/gitq',
      daemonToken: grant('glpat-daemon') as never,
    });
    expect(res).toEqual({ token: 'glpat-daemon' });
  });

  test("the daemon's refusal comes back verbatim as the reason", async () => {
    const res = await resolveForgeToken('gitlab', {
      env: {},
      repoPath: '/Users/matt/Documents/GitHub/gitq',
      daemonToken: refuse as never,
    });
    expect(res.token).toBeNull();
    expect(res.reason).toContain('not tracked by rt');
    expect(res.reason).toContain('rt daemon track');
  });

  test('no repoPath means env-only, with a reason saying so', async () => {
    const res = await resolveForgeToken('gitlab', { env: {}, daemonToken: explode as never });
    expect(res.token).toBeNull();
    expect(res.reason).toContain('no repo path');
  });

  test('a repo unknown to ~/.mattstack/rt/repos.json fails closed before any daemon call', async () => {
    const res = await resolveForgeToken('gitlab', {
      env: {},
      repoPath: '/definitely/not/registered/anywhere',
      daemonToken: explode as never,
    });
    expect(res.token).toBeNull();
    expect(res.reason).toContain('not registered with rt');
  });

  describe('per-host tokenEnv override', () => {
    test('is authoritative when set', async () => {
      const res = await resolveForgeToken('github', {
        env: { GHE_ACME_TOKEN: 'ghp-ghe' },
        tokenEnv: 'GHE_ACME_TOKEN',
        daemonToken: explode as never,
      });
      expect(res).toEqual({ token: 'ghp-ghe' });
    });

    test('an empty override never falls back to the forge default or the daemon', async () => {
      const res = await resolveForgeToken('github', {
        env: { GITHUB_TOKEN: 'ghp-dotcom' },
        tokenEnv: 'GHE_ACME_TOKEN',
        repoPath: '/repo',
        daemonToken: explode as never,
      });
      expect(res.token).toBeNull();
      expect(res.reason).toBe('set GHE_ACME_TOKEN');
    });
  });
});

describe('tokenSourceHint', () => {
  test('names the env var and the rt grant path', () => {
    expect(tokenSourceHint('github')).toBe(
      'set GITHUB_TOKEN or track the repo with rt (rt daemon track <repo> live branches)',
    );
    expect(tokenSourceHint('gitlab')).toBe(
      'set GITLAB_TOKEN or track the repo with rt (rt daemon track <repo> live branches)',
    );
  });

  test('an instance-specific tokenEnv is the whole hint', () => {
    expect(tokenSourceHint('github', 'GHE_ACME_TOKEN')).toBe('set GHE_ACME_TOKEN');
  });
});
