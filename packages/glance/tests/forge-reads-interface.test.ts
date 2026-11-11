import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { ForgeHttpError } from '../src/errors.ts';
import type { ProviderCapabilities } from '../src/types.ts';

const providers = {
  github: new GitHubProvider('https://github.com', 'token-not-used'),
  gitlab: new GitLabProvider('https://gitlab.com', 'token-not-used')
};

const GUARDS: Array<[keyof ProviderCapabilities, string[]]> = [
  ['canFetchProjectLabels', ['fetchProjectLabels']],
  ['canFetchPipelineList', ['fetchPipelineList']],
  ['canFetchCommitParents', ['fetchCommitParents']],
  ['canFetchPipelineFailedJobs', ['fetchPipelineFailedJobs']],
  ['canFetchPullRequestSummaries', ['fetchPullRequestSummaries']],
  ['canEditLabels', ['addPullRequestLabels', 'removePullRequestLabels']]
];

describe('forge reads interface', () => {
  for (const [name, provider] of Object.entries(providers)) {
    for (const [flag, methods] of GUARDS) {
      test(`${name}: ${flag} is a boolean and matches its methods`, () => {
        const value = provider.capabilities[flag];
        expect(typeof value).toBe('boolean');
        for (const method of methods) {
          const member = (provider as unknown as Record<string, unknown>)[method];
          expect(`${method}:${typeof member}`).toBe(`${method}:${value ? 'function' : 'undefined'}`);
        }
      });
    }
  }

  test('all six new flags are true on both providers', () => {
    for (const provider of Object.values(providers)) {
      for (const [flag] of GUARDS) expect(`${flag}:${provider.capabilities[flag]}`).toBe(`${flag}:true`);
    }
  });

  test('ForgeHttpError carries status, statusText and bodyText', () => {
    const err = new ForgeHttpError('GitLab returned 404 Not Found: nope', 404, 'Not Found', '{"message":"nope"}');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.statusText).toBe('Not Found');
    expect(err.bodyText).toBe('{"message":"nope"}');
    expect(err.message).toBe('GitLab returned 404 Not Found: nope');
  });
});
