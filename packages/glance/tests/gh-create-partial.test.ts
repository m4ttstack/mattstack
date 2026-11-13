/**
 * A GitHub create whose PR exists but whose reviewers, assignees or labels
 * step failed throws `PartialCreateError` after attempting every step.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { PartialCreateError, RateLimitedError, ReadBackFailedError } from '../src/index.ts';
import type { CreatePullRequestInput, PullRequest } from '../src/types.ts';

type Answer = (route: string) => unknown;

function requestError(status: number, message: string, route: string): RequestError {
  const [method, url] = route.split(' ');
  return new RequestError(message, status, {
    request: { method: method as 'POST', url: url!, headers: {} },
    response: { status, url: url!, headers: {}, data: { message }, retryCount: 0 }
  });
}

function stubProvider(answer: Answer, readBack: () => Promise<PullRequest | null> = async () => ({ iid: 42 }) as PullRequest) {
  const provider = new GitHubProvider('https://github.com', 'tok-create-partial');
  const routes: string[] = [];
  (provider as any).octokit = {
    request: async (route: string) => {
      routes.push(route);
      if (route === 'POST /repos/acme/repo/pulls') {
        return { status: 201, headers: {}, data: { number: 42, node_id: 'PR_42' } };
      }
      const out = answer(route);
      if (out instanceof Error) throw out;
      return { status: 200, headers: {}, data: out ?? {} };
    }
  };
  (provider as any).fetchSingleMR = readBack;
  return { provider, routes };
}

function input(over: Partial<CreatePullRequestInput> = {}): CreatePullRequestInput {
  return {
    projectPath: 'acme/repo',
    title: 'My feature',
    sourceBranch: 'feat',
    targetBranch: 'main',
    ...over
  };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

const REVIEWERS = 'POST /repos/acme/repo/pulls/42/requested_reviewers';
const ASSIGNEES = 'POST /repos/acme/repo/issues/42/assignees';
const LABELS = 'POST /repos/acme/repo/issues/42/labels';

describe('GitHubProvider.createPullRequest partial create', () => {
  test('a refused label write throws PartialCreateError', async () => {
    const { provider } = stubProvider(route =>
      route === LABELS ? requestError(422, 'Label does not exist', route) : undefined
    );

    const err = await caught(provider.createPullRequest(input({ labels: ['nope'] })));

    expect(err).toBeInstanceOf(PartialCreateError);
    expect(err).toBeInstanceOf(ReadBackFailedError);
    const partial = err as PartialCreateError;
    expect(partial.name).toBe('PartialCreateError');
    expect(partial.writeApplied).toBe(true);
    expect(partial.operation).toBe('createPullRequest');
    expect(partial.projectPath).toBe('acme/repo');
    expect(partial.iid).toBe(42);
    expect(partial.failedSteps).toHaveLength(1);
    expect(partial.failedSteps[0]!.step).toBe('labels');
    expect(partial.failedSteps[0]!.message).toContain('422');
    expect(partial.pullRequest).not.toBeNull();
    expect(partial.pullRequest?.iid).toBe(42);
    expect(partial.message).toBe(`Created PR #42 but could not apply labels: ${partial.failedSteps[0]!.message}`);
  });

  test('a reviewer GitHub accepts but drops from requested_reviewers is a failed reviewers step', async () => {
    const { provider } = stubProvider(route =>
      route === REVIEWERS ? { number: 42, requested_reviewers: [{ login: 'alice' }] } : undefined
    );

    const err = await caught(provider.createPullRequest(input({ reviewers: ['alice', 'glance-no-such-user'] })));

    expect(err).toBeInstanceOf(PartialCreateError);
    const partial = err as PartialCreateError;
    expect(partial.failedSteps.map(s => s.step)).toEqual(['reviewers']);
    expect(partial.failedSteps[0]!.message).toBe(
      'createPullRequest reviewers for #42: GitHub accepted the request but did not add glance-no-such-user as a reviewer'
    );
    expect(partial.pullRequest?.iid).toBe(42);
  });

  test('reviewer logins match requested_reviewers without regard to case', async () => {
    const { provider } = stubProvider(route =>
      route === REVIEWERS ? { number: 42, requested_reviewers: [{ login: 'Alice' }] } : undefined
    );
    const pr = await provider.createPullRequest(input({ reviewers: ['alice'] }));
    expect(pr.iid).toBe(42);
  });

  test('a refused reviewer step still applies assignees and labels', async () => {
    const { provider, routes } = stubProvider(route =>
      route === REVIEWERS ? requestError(422, 'Review cannot be requested from pull request author', route) : undefined
    );

    const err = await caught(
      provider.createPullRequest(input({ reviewers: ['me'], assignees: ['ada'], labels: ['bug'] }))
    );

    expect(routes).toContain(ASSIGNEES);
    expect(routes).toContain(LABELS);
    const partial = err as PartialCreateError;
    expect(partial).toBeInstanceOf(PartialCreateError);
    expect(partial.failedSteps.map(s => s.step)).toEqual(['reviewers']);
    expect(partial.pullRequest?.iid).toBe(42);
  });

  test('every failed step is listed, in order, in the message', async () => {
    const { provider } = stubProvider(route =>
      route === REVIEWERS || route === LABELS ? requestError(422, 'nope', route) : undefined
    );

    const partial = (await caught(
      provider.createPullRequest(input({ reviewers: ['me'], assignees: ['ada'], labels: ['bug'] }))
    )) as PartialCreateError;

    expect(partial.failedSteps.map(s => s.step)).toEqual(['reviewers', 'labels']);
    expect(partial.message).toStartWith('Created PR #42 but could not apply reviewers, labels: ');
    expect(partial.message).toContain(partial.failedSteps[0]!.message);
  });

  test('a transport failure is recorded as a failed step', async () => {
    const transport = new TypeError('fetch failed');
    const { provider } = stubProvider(route => (route === ASSIGNEES ? transport : undefined));

    const partial = (await caught(provider.createPullRequest(input({ assignees: ['ada'] })))) as PartialCreateError;

    expect(partial).toBeInstanceOf(PartialCreateError);
    expect(partial.failedSteps).toEqual([{ step: 'assignees', message: 'fetch failed', cause: transport }]);
  });

  test('a rate limit is recorded as a failed step', async () => {
    const limited = new RateLimitedError('GitHub secondary rate limit hit on POST', {
      kind: 'secondary',
      resetAt: null,
      retryAfterMs: 60_000,
      operation: LABELS
    });
    const { provider } = stubProvider(route => (route === LABELS ? limited : undefined));

    const partial = (await caught(provider.createPullRequest(input({ labels: ['bug'] })))) as PartialCreateError;

    expect(partial.failedSteps).toHaveLength(1);
    expect(partial.failedSteps[0]!.step).toBe('labels');
    expect(partial.failedSteps[0]!.cause).toBe(limited);
  });

  test('a failed step plus a failed read-back still throws PartialCreateError with pullRequest null', async () => {
    const { provider } = stubProvider(
      route => (route === LABELS ? requestError(422, 'Label does not exist', route) : undefined),
      async () => {
        throw new Error('graphql down');
      }
    );

    const err = await caught(provider.createPullRequest(input({ labels: ['nope'] })));

    expect(err).toBeInstanceOf(PartialCreateError);
    const partial = err as PartialCreateError;
    expect(partial.pullRequest).toBeNull();
    expect(partial.writeApplied).toBe(true);
    expect(partial.failedSteps.map(s => s.step)).toEqual(['labels']);
    expect(partial.cause).toBeInstanceOf(ReadBackFailedError);
  });

  test('with no failed step create returns the PR as before', async () => {
    const { provider, routes } = stubProvider(() => undefined);

    const pr = await provider.createPullRequest(input({ reviewers: ['ada'], assignees: ['bob'], labels: ['bug'] }));

    expect(pr.iid).toBe(42);
    expect(routes).toEqual(['POST /repos/acme/repo/pulls', REVIEWERS, ASSIGNEES, LABELS]);
  });

  test('with no failed step a failed read-back is the plain ReadBackFailedError', async () => {
    const { provider } = stubProvider(
      () => undefined,
      async () => null
    );

    const err = await caught(provider.createPullRequest(input({ labels: ['bug'] })));

    expect(err).toBeInstanceOf(ReadBackFailedError);
    expect(err).not.toBeInstanceOf(PartialCreateError);
  });
});
