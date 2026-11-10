#!/usr/bin/env bun
/**
 * Octokit client construction and error translation.
 *
 * The error messages are not cosmetic: the live conformance harness matches
 * them by pattern to tell a transient failure from a permanent one, so a
 * reworded message silently disables a check rather than failing it.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import {
  createGitHubClient,
  ghError,
  RATE_LIMIT_RETRY_DEADLINE_S,
  resolveGitHubUrls,
  toRateLimitedError
} from '../src/githubClient.ts';
import { RateLimitedError } from '../src/errors.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { FetchPullRequestsWarning } from '../src/GitProvider.ts';
import { noopLogger } from '../src/logger.ts';
import type { RequestInfo } from '../src/instrumentation.ts';

/**
 * Runs `fn` with `setTimeout` collapsed to fire on the next tick, then
 * restores the real one. `@octokit/plugin-throttling` paces every write
 * (and, since a GraphQL request is a POST, every GraphQL call too) through a
 * process-wide Bottleneck group with a real `minTime: 1000`; across a whole
 * `bun test` run sharing one process, tests that touch this group after
 * many others have already run pay back that group's accumulated real-time
 * backlog unless the wait is collapsed here. See the identical helper and
 * longer explanation in `gh-transport.test.ts`.
 */
async function withInstantTimers<T>(fn: () => Promise<T>): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    _ms?: number,
    ...args: unknown[]
  ) => realSetTimeout(callback, 0, ...args)) as typeof setTimeout;
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

describe('resolveGitHubUrls', () => {
  test('github.com maps to the api subdomain', () => {
    expect(resolveGitHubUrls('https://github.com')).toEqual({
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    });
  });

  test('the www host is treated as github.com', () => {
    expect(resolveGitHubUrls('https://www.github.com').apiBase).toBe(
      'https://api.github.com'
    );
  });

  test('an enterprise host serves REST under /api/v3 and GraphQL under /api/graphql', () => {
    expect(resolveGitHubUrls('https://ghe.corp.example')).toEqual({
      apiBase: 'https://ghe.corp.example/api/v3',
      graphqlURL: 'https://ghe.corp.example/api/graphql'
    });
  });
});

function fakeRequestError(status: number, body: unknown): RequestError {
  return new RequestError('Oops', status, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
    response: {
      status,
      url: 'https://api.github.com/x',
      headers: {},
      data: body
    }
  });
}

describe('ghError', () => {
  test('plain style reproduces the shape most methods use today', () => {
    const err = ghError(
      'mergePullRequest',
      fakeRequestError(405, { message: 'Pull Request is not mergeable' })
    );
    expect(err.message).toMatch(/^mergePullRequest failed: 405 /);
    expect(err.message).toContain('Pull Request is not mergeable');
  });

  test('the harness pattern for a merge precondition still matches', () => {
    const err = ghError('mergePullRequest', fakeRequestError(405, {}));
    expect(/\bmergePullRequest failed: 405\b/.test(err.message)).toBe(true);
  });

  test('the harness pattern for self-approval rejection still matches', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(422, { message: 'Unprocessable Entity' }),
      'statusText'
    );
    expect(/approvePullRequest failed: 422\b/.test(err.message)).toBe(true);
  });

  test('a non-RequestError is preserved rather than relabelled as an HTTP failure', () => {
    const err = ghError('fetchJobTrace', new TypeError('network down'));
    expect(err.message).toContain('network down');
    expect(err.message).not.toMatch(/failed: \d/);
  });

  test('statusText style reconstructs the reason phrase for a 403, since Octokit never carries it on the response', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(403, {}),
      'statusText'
    );
    expect(err.message).toContain('403 Forbidden');
  });

  test('statusText style reconstructs the reason phrase for a 422', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(422, {}),
      'statusText'
    );
    expect(err.message).toContain('422 Unprocessable Entity');
  });

  test('an unmapped status in statusText style degrades to no phantom reason phrase', () => {
    const err = ghError('approvePullRequest', fakeRequestError(418, {}), 'statusText');
    expect(/\bapprovePullRequest failed: 418\b/.test(err.message)).toBe(true);
    expect(err.message).not.toMatch(/418 [A-Za-z]/);
  });

  test('a RequestError with no response falls back to err.message so the diagnostic survives', () => {
    const networkErr = new RequestError('network down', 500, {
      request: { method: 'GET', url: 'https://api.github.com/x', headers: {} }
    });
    const err = ghError('fetchJobTrace', networkErr);
    expect(err.message).toContain('network down');
  });
});

describe('createGitHubClient instrumentation', () => {
  test('emits one RequestInfo per request, with the op label and real status', async () => {
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    await octokit.request('GET /user', {
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ login: 'octocat' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.transport).toBe('rest');
    expect(seen[0]?.status).toBe(200);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.path).toContain('/user');
    expect(seen[0]?.op).toContain('GET');
    expect(seen[0]?.op).toContain('/user');
    expect(typeof seen[0]?.durationMs).toBe('number');
    expect(seen[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('emits for a failed request too, carrying the real status', async () => {
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    await octokit
      .request('GET /user', {
        request: {
          // Retries would turn one logical operation into several events, and
          // the SDK counts logical operations, so they stay off here.
          retries: 0,
          fetch: async () =>
            new Response(JSON.stringify({ message: 'Bad credentials' }), {
              status: 401,
              headers: { 'content-type': 'application/json' }
            })
        }
      })
      .catch(() => undefined);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe(401);
  });

  test('a throwing onRequest hook cannot break the request', async () => {
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: () => {
        throw new Error('observer is broken');
      }
    });

    const res = await octokit.request('GET /user', {
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ login: 'octocat' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    });

    expect(res.status).toBe(200);
  });

  test('a GraphQL request is labelled transport: graphql, not rest', async () => {
    // `RequestInfo.transport` has a `'graphql'` value specifically for this
    // case (see its docstring in `src/instrumentation.ts`), but before this
    // fix `emit()` hardcoded `'rest'` for every request, including the
    // GraphQL ones `octokit.graphql` started making once `graphql()` moved
    // onto it -- a regression this transport swap should not have caused,
    // since bare `fetch` never emitted instrumentation for GraphQL at all.
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    // This provider's `id` (`apiBase::token`) is shared with the many other
    // tests across this suite that also use `'https://github.com'` and
    // `'tok'`, so this GraphQL POST lands in the same write-group Bottleneck
    // key those tests have already pushed real time into -- see
    // `withInstantTimers`'s docstring above.
    await withInstantTimers(() =>
      octokit.graphql('query { viewer { login } }', {
        request: {
          fetch: async () =>
            new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
        }
      })
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.transport).toBe('graphql');
    expect(seen[0]?.status).toBe(200);
  });
});

describe('createGitHubClient throttle id', () => {
  test('two clients for different hosts/tokens do not pace each other (per-instance throttle id)', async () => {
    // `@octokit/plugin-throttling` keys its "write" Bottleneck group
    // (`minTime: 1000`) in a module-scope singleton, defaulting every caller
    // to the same `id: "no-id"` when none is passed. Without a per-instance
    // id, a write on one `GitHubProvider` would force the very next write on
    // an unrelated `GitHubProvider` (different host, different token, no
    // shared rate-limit budget) to wait out that same 1s pacing. Measuring
    // real elapsed time here (not `withInstantTimers`) is the point: the
    // absence of an artificial wait is exactly what's being proven.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    try {
      const a = createGitHubClient({
        baseURL: 'https://github.com',
        token: 'tok-a',
        log: noopLogger
      });
      const b = createGitHubClient({
        baseURL: 'https://ghe.corp.example',
        token: 'tok-b',
        log: noopLogger
      });

      await a.request('DELETE /repos/acme/repo/git/refs/heads/a', {
        request: { retries: 0 }
      });
      const started = performance.now();
      await b.request('DELETE /repos/acme/repo/git/refs/heads/b', {
        request: { retries: 0 }
      });

      // A shared "no-id" group would measure ~1000ms here (the write
      // group's `minTime`); a generous 500ms bound still fails against that
      // shared wait while giving CI jitter room.
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('rate limits fail fast', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function limited(
    status: number,
    headers: Record<string, string>,
    message = 'API rate limit exceeded'
  ): Response {
    return new Response(JSON.stringify({ message }), {
      status,
      headers: { 'content-type': 'application/json', ...headers }
    });
  }

  function stub(responses: Array<() => Response>): { calls: number } {
    const state = { calls: 0 };
    globalThis.fetch = (async () => {
      const respond = responses[Math.min(state.calls, responses.length - 1)]!;
      state.calls++;
      return respond();
    }) as unknown as typeof fetch;
    return state;
  }

  function client(token: string) {
    return createGitHubClient({
      baseURL: 'https://github.com',
      token,
      log: noopLogger
    });
  }

  const inAnHour = () => String(Math.floor(Date.now() / 1000) + 3600);

  test('the deadline is 30 seconds', () => {
    expect(RATE_LIMIT_RETRY_DEADLINE_S).toBe(30);
  });

  test('a primary limit past the deadline fails after one request', async () => {
    const reset = inAnHour();
    const state = stub([
      () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })
    ]);

    const err = await withInstantTimers(() =>
      client('tok-primary').request('GET /repos/a/b/pulls/1').catch(e => e)
    );

    expect(state.calls).toBe(1);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.kind).toBe('primary');
    expect(err.resetAt).toBe(new Date(Number(reset) * 1000).toISOString());
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  test('a short Retry-After is honoured and retried', async () => {
    const state = stub([
      () =>
        limited(
          429,
          { 'retry-after': '1' },
          'You have exceeded a secondary rate limit. Please wait.'
        ),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    ]);

    const res = await withInstantTimers(() =>
      client('tok-short').request('GET /repos/a/b/pulls/1')
    );

    expect(state.calls).toBe(2);
    expect(res.status).toBe(200);
  });

  test('a secondary limit past the deadline fails fast', async () => {
    const state = stub([
      () =>
        limited(
          429,
          { 'retry-after': '120' },
          'You have exceeded a secondary rate limit. Please wait.'
        )
    ]);

    const err = await withInstantTimers(() =>
      client('tok-secondary').request('GET /repos/a/b/pulls/1').catch(e => e)
    );

    expect(state.calls).toBe(1);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.kind).toBe('secondary');
    expect(err.retryAfterMs).toBe(120_000);
  });

  test('a 429 with Retry-After and no secondary-limit message also fails fast', async () => {
    const state = stub([() => limited(429, { 'retry-after': '120' }, 'Too Many Requests')]);

    const err = await withInstantTimers(() =>
      client('tok-bare429').request('GET /repos/a/b/pulls/1').catch(e => e)
    );

    expect(state.calls).toBe(1);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.kind).toBe('secondary');
  });

  test('a plain 403 is not a rate limit and stays a RequestError', async () => {
    stub([() => limited(403, {}, 'Resource not accessible')]);

    const err = await withInstantTimers(() =>
      client('tok-403').request('GET /repos/a/b/pulls/1').catch(e => e)
    );

    expect(err).toBeInstanceOf(RequestError);
    expect(err.status).toBe(403);
  });

  test('a throttled write keeps its RequestError and waits out the limit twice', async () => {
    const state = stub([
      () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': inAnHour() })
    ]);

    const err = await withInstantTimers(() =>
      client('tok-write').request('POST /repos/a/b/issues', { title: 't' }).catch(e => e)
    );

    expect(err).toBeInstanceOf(RequestError);
    expect(state.calls).toBe(3);
  });

  test('a write hitting a secondary limit with no Retry-After still retries twice', async () => {
    const state = stub([
      () => limited(403, {}, 'You have exceeded a secondary rate limit. Please wait.')
    ]);

    const err = await withInstantTimers(() =>
      client('tok-write-secondary')
        .request('POST /repos/a/b/issues', { title: 't' })
        .catch(e => e)
    );

    expect(err).toBeInstanceOf(RequestError);
    expect(state.calls).toBe(3);
  });

  test('a rate-limited single-PR read throws RateLimitedError with resetAt', async () => {
    const reset = inAnHour();
    stub([
      () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })
    ]);
    const warnings: FetchPullRequestsWarning[] = [];

    const provider = new GitHubProvider('https://github.com', 'tok-warn');
    const err = await withInstantTimers(() =>
      provider.fetchSingleMR('a/b', 1, null, w => warnings.push(w)).catch(e => e)
    );

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.kind).toBe('primary');
    expect(err.resetAt).toBe(new Date(Number(reset) * 1000).toISOString());
    expect(warnings).toEqual([]);
  });

  test('a rate-limited iids read throws rather than returning a short list', async () => {
    stub([
      () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': inAnHour() })
    ]);

    const provider = new GitHubProvider('https://github.com', 'tok-iids-limited');
    const err = await withInstantTimers(() =>
      provider.fetchPullRequests({ projectPath: 'a/b', iids: [1] }).catch(e => e)
    );

    expect(err).toBeInstanceOf(RateLimitedError);
  });

  test('a rate-limited fill on a search path throws RateLimitedError with resetAt', async () => {
    const reset = inAnHour();
    stub([
      () =>
        new Response(
          JSON.stringify({
            items: [
              {
                number: 1,
                state: 'open',
                updated_at: '2026-07-10T00:00:00Z',
                repository_url: 'https://api.github.com/repos/a/b',
                pull_request: { merged_at: null }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
      () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })
    ]);
    const warnings: FetchPullRequestsWarning[] = [];

    const provider = new GitHubProvider('https://github.com', 'tok-listwarn');
    const err = await withInstantTimers(() =>
      provider
        .fetchPullRequests({
          projectPath: 'a/b',
          authorUsernames: ['alice'],
          onWarning: w => warnings.push(w)
        })
        .catch(e => e)
    );

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.resetAt).toBe(new Date(Number(reset) * 1000).toISOString());
    expect(warnings).toEqual([]);
  });

  test('a rate-limited list read throws RateLimitedError', async () => {
    stub([
      () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': inAnHour() })
    ]);

    const provider = new GitHubProvider('https://github.com', 'tok-list');
    const err = await withInstantTimers(() =>
      provider.fetchPullRequests({ projectPath: 'a/b' }).catch(e => e)
    );

    expect(err).toBeInstanceOf(RateLimitedError);
  });
});

describe('toRateLimitedError', () => {
  const info = { method: 'GET' as const, url: 'https://api.github.com/x', headers: {} };

  function requestError(status: number, headers: Record<string, string>, message = 'Oops') {
    return new RequestError(message, status, {
      request: info,
      response: { status, url: info.url, headers, data: { message }, retryCount: 0 }
    });
  }

  test('reads a primary limit off a 403 with no remaining quota', () => {
    const out = toRateLimitedError(
      requestError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' }),
      'GET /x'
    );
    expect(out).toBeInstanceOf(RateLimitedError);
    expect(out?.kind).toBe('primary');
    expect(out?.resetAt).toBe(new Date(2_000_000_000_000).toISOString());
    expect(out?.operation).toBe('GET /x');
  });

  test('reads a secondary limit off a 429 with Retry-After', () => {
    const out = toRateLimitedError(requestError(429, { 'retry-after': '7' }), 'GET /x');
    expect(out?.kind).toBe('secondary');
    expect(out?.retryAfterMs).toBe(7000);
  });

  test('reads a GraphQL RATE_LIMITED error', () => {
    const err = Object.assign(new Error('GraphQL Rate Limit Exceeded'), {
      response: {
        headers: { 'x-ratelimit-reset': '2000000000' },
        data: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }
      }
    });
    const out = toRateLimitedError(err, 'graphql');
    expect(out?.kind).toBe('primary');
    expect(out?.resetAt).toBe(new Date(2_000_000_000_000).toISOString());
  });

  test('reads a GraphqlResponseError-shaped RATE_LIMITED error', () => {
    const err = Object.assign(new Error('Request failed due to following response errors'), {
      errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      headers: {}
    });
    expect(toRateLimitedError(err, 'graphql')?.kind).toBe('primary');
  });

  test('returns null for anything else', () => {
    expect(toRateLimitedError(requestError(403, {}), 'GET /x')).toBeNull();
    expect(toRateLimitedError(requestError(404, {}), 'GET /x')).toBeNull();
    expect(toRateLimitedError(new Error('boom'), 'GET /x')).toBeNull();
    expect(toRateLimitedError('nope', 'GET /x')).toBeNull();
    expect(toRateLimitedError(null, 'GET /x')).toBeNull();
  });
});
