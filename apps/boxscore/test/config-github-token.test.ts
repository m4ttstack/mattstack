import { describe, expect, it } from 'vitest';

import {
  serializeIdentity,
  type ForgeTokenData,
  type RtResponse,
} from '@mattstack/rt-client';
import {
  githubRepoName,
  readGitHubToken,
} from '../src/server/config/github-token.js';

const REFUSAL_A =
  'repo o/a is not tracked by rt ... rt daemon track o/a live branches';
const REFUSAL_B =
  'repo o/b is not tracked by rt ... rt daemon track o/b live branches';

function fakeForgeToken(answers: Record<string, RtResponse<ForgeTokenData>>): {
  calls: string[];
  forgeToken: (repoName: string) => Promise<RtResponse<ForgeTokenData>>;
} {
  const calls: string[] = [];
  return {
    calls,
    async forgeToken(repoName) {
      calls.push(repoName);
      return answers[repoName] ?? { ok: false, error: 'unexpected repo' };
    },
  };
}

describe('readGitHubToken', () => {
  it('GITHUB_TOKEN wins and the daemon is not asked', async () => {
    const { calls, forgeToken } = fakeForgeToken({});

    expect(
      await readGitHubToken(['o/a'], {
        env: { GITHUB_TOKEN: ' t1 ' },
        forgeToken,
      })
    ).toEqual({ token: 't1' });
    expect(calls).toEqual([]);
  });

  it('asks each project in order until one grants', async () => {
    const { calls, forgeToken } = fakeForgeToken({
      [githubRepoName('o/a')]: { ok: false, error: REFUSAL_A },
      [githubRepoName('o/b')]: { ok: true, data: { token: 't2' } },
    });

    expect(
      await readGitHubToken(['o/a', 'o/b'], { env: {}, forgeToken })
    ).toEqual({ token: 't2' });
    expect(calls).toEqual([githubRepoName('o/a'), githubRepoName('o/b')]);
  });

  it("every refusal gives the first refusal's text", async () => {
    const { forgeToken } = fakeForgeToken({
      [githubRepoName('o/a')]: { ok: false, error: REFUSAL_A },
      [githubRepoName('o/b')]: { ok: false, error: REFUSAL_B },
    });

    expect(
      await readGitHubToken(['o/a', 'o/b'], { env: {}, forgeToken })
    ).toEqual({ token: null, reason: REFUSAL_A });
  });

  it('no projects gives a reason naming boxscore.projects', async () => {
    const { calls, forgeToken } = fakeForgeToken({});

    const result = await readGitHubToken([], { env: {}, forgeToken });

    expect(result.token).toBeNull();
    expect(result).toEqual({
      token: null,
      reason: expect.stringContaining('boxscore.projects'),
    });
    expect(calls).toEqual([]);
  });

  it('under vitest with no injected forgeToken, the daemon is never asked', async () => {
    expect(await readGitHubToken(['o/a'], { env: {} })).toEqual({
      token: null,
      reason: 'tests must inject forgeToken',
    });
  });
});

describe('githubRepoName', () => {
  it('is the serialized github.com remote identity', () => {
    expect(githubRepoName('Org/Repo')).toBe(
      serializeIdentity({ kind: 'remote', id: 'github.com/Org/Repo' })
    );
  });
});
