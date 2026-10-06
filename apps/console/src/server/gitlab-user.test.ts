// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetGitlabUsername,
  gitlabUsername,
  type GitlabUserDeps,
} from './gitlab-user';

afterEach(() => __resetGitlabUsername());

const deps = (over: Partial<Parameters<typeof gitlabUsername>[0]> = {}) => ({
  host: () => 'gitlab.example.com',
  token: async () => 'glpat-x',
  fetch: vi.fn(
    async () => new Response(JSON.stringify({ username: 'ada' }))
  ) as unknown as GitlabUserDeps['fetch'],
  ...over,
});

describe('gitlabUsername', () => {
  it("asks the confirmed host's /user with the token", async () => {
    const d = deps();
    expect(await gitlabUsername(d)).toBe('ada');
    expect(d.fetch).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/user',
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'glpat-x' } })
    );
  });

  it('asks GitLab once per process', async () => {
    const d = deps();
    await gitlabUsername(d);
    await gitlabUsername(d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it('is null with no confirmed host or no token, without asking', async () => {
    const noHost = deps({ host: () => undefined });
    expect(await gitlabUsername(noHost)).toBeNull();
    const noToken = deps({ token: async () => null });
    expect(await gitlabUsername(noToken)).toBeNull();
    expect(noHost.fetch).not.toHaveBeenCalled();
    expect(noToken.fetch).not.toHaveBeenCalled();
  });

  it('is null when GitLab refuses or the request throws', async () => {
    const refused = deps({
      fetch: (async () =>
        new Response('no', {
          status: 401,
        })) as unknown as GitlabUserDeps['fetch'],
    });
    expect(await gitlabUsername(refused)).toBeNull();
    const thrown = deps({
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as GitlabUserDeps['fetch'],
    });
    expect(await gitlabUsername(thrown)).toBeNull();
  });

  it('never reaches GitLab from a test that injects nothing', async () => {
    expect(await gitlabUsername()).toBeNull();
  });
});
