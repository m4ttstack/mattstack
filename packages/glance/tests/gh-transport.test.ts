#!/usr/bin/env bun
/**
 * End-to-end coverage of GitHubProvider's api() over the real Octokit
 * transport, stubbing `fetch` itself rather than `api()`.
 *
 * Every other GitHub test in this suite monkey-patches `(provider as
 * any).api`, which means none of them ever exercise what Octokit actually
 * does to a path or a response: whether a colon in a query value survives
 * as a literal colon, whether a 204 comes back as a valid Response, whether
 * a 404 still resolves rather than throwing, and whether a transport-level
 * failure surfaces as itself rather than as a fabricated Response. Octokit
 * reads `globalThis.fetch` at call time (see
 * `@octokit/request/dist-src/fetch-wrapper.js`: `requestOptions.request?.fetch
 * || globalThis.fetch`), so stubbing the global here reaches all the way
 * through the real client built by `createGitHubClient`.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { PartialCreateError } from '../src/errors.ts';
import type { FetchPullRequestsWarning } from '../src/GitProvider.ts';
import { ghNode } from './helpers/gh-fill-fixture.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Installs a fetch stub that records every requested URL and answers via `respond`. */
function stubFetch(respond: (url: string) => Response | Promise<Response>): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    return respond(url);
  }) as typeof fetch;
  return urls;
}

/**
 * Runs `fn` with `setTimeout` collapsed to fire on the next tick regardless
 * of the requested delay, then restores the real one.
 *
 * The retry plugin (`@octokit/plugin-retry`, via Bottleneck) schedules its
 * backoff with a bare, module-scope `setTimeout` -- see `bottleneck/light.js`
 * -- so patching the global reaches it without needing to know Bottleneck's
 * internals. This exists so a test that drives a GET through exhausted
 * retries (which cannot get `retries: 0` the way a DELETE test can, since
 * that flag only applies to non-idempotent verbs) can assert on the outcome
 * without paying for the real quadratic backoff, which the test is not
 * verifying.
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

/** The token the rest of the suite's GitHub tests construct providers with. */
const SUITE_TOKEN = 'tok';

/**
 * `@octokit/plugin-throttling` keeps its write pacing in module scope, keyed
 * by host and token, so it outlives a test file. A file that collapses
 * `setTimeout` still pushes Bottleneck's next-request time a second forward
 * per write or GraphQL POST, and a later file on the same host and token
 * waits that time out for real: CI's file order once put gh-merge-queue
 * first and stalled this file's writes past the test timeout. Ten seconds of
 * that debt left here holds the condition whatever the order, so a test that
 * builds its provider on the shared token instead of `isolatedProvider` fails.
 */
beforeAll(async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const indebted = new GitHubProvider('https://github.com', SUITE_TOKEN);
  await withInstantTimers(async () => {
    for (let i = 0; i < 10; i++) {
      await (indebted as any).api('DELETE', `/repos/acme/repo/git/refs/heads/debt-${i}`);
    }
  });
  globalThis.fetch = realFetch;
});

let isolatedTokens = 0;

/** A provider on a token no other test uses, so no earlier pacing reaches it. */
function isolatedProvider(baseURL = 'https://github.com', label = 'tok'): GitHubProvider {
  isolatedTokens += 1;
  return new GitHubProvider(baseURL, `${label}-transport-${isolatedTokens}`);
}

describe('GitHubProvider transport (real Octokit, fetch stubbed)', () => {
  test('fetchPullRequestByBranch sends head=owner:branch intact, even when the branch contains a slash', async () => {
    // This is the regression case for the Octokit placeholder bug: Octokit's
    // endpoint parser (@octokit/endpoint) rewrites `:word` into a route
    // placeholder before the path is used, and an unmatched placeholder
    // expands to the empty string. Against the pre-fix call site (raw
    // `${owner}:${encodeURIComponent(branch)}`), the URL that actually
    // reaches fetch drops everything from the colon onward instead of
    // carrying `head=acme%3Afeature%2Fmy-branch`, so this assertion fails
    // against the unfixed code.
    const urls = stubFetch(() => jsonResponse([]));

    const provider = isolatedProvider();
    await provider.fetchPullRequestByBranch('acme/repo', 'feature/my-branch');

    const headCall = urls.find(u => u.includes('/pulls?head='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain(`head=${encodeURIComponent('acme:feature/my-branch')}`);
  });

  test('a 204 response is handled without throwing and constructs a Response with a null body', async () => {
    // `new Response("", { status: 204 })` is permitted by Bun but throws a
    // TypeError under Node, and Octokit's fetch wrapper hands back
    // `data: ""` for 204/205 either way. This assertion must hold on the
    // constructed Response's shape (status + null body), not merely on the
    // absence of a throw, since the throw itself only happens under Node
    // and this suite runs on Bun.
    stubFetch(() => new Response(null, { status: 204 }));

    const provider = isolatedProvider();
    const res = await (provider as any).api(
      'DELETE',
      '/repos/acme/repo/git/refs/heads/some-branch'
    );

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  test('a 404 through restRequest resolves with ok: false instead of throwing', async () => {
    // branchExists() in the live harness, and several call sites in this
    // provider, depend on a 404 coming back as a Response they can branch
    // on rather than as a thrown error.
    stubFetch(() => jsonResponse({ message: 'Not Found' }, 404));

    const provider = isolatedProvider();
    const res = await provider.restRequest('GET', '/repos/acme/repo/branches/missing');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  test('restRequest with redirect manual passes it to fetch and returns the 302 unfollowed', async () => {
    const inits: Array<RequestInit | undefined> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      inits.push(init);
      return new Response(null, { status: 302, headers: { location: 'https://blob.example/x' } });
    }) as typeof fetch;

    const provider = isolatedProvider();
    const res = await provider.restRequest('GET', '/x', undefined, 'op', { redirect: 'manual' });

    expect(inits).toHaveLength(1);
    expect(inits[0]?.redirect).toBe('manual');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://blob.example/x');
  });

  test('restRequest carries a non-Link header (etag) through, not just Link', async () => {
    // Before Octokit, restRequest returned the genuine fetch Response, so a
    // caller could read content-type, etag, location, x-ratelimit-remaining,
    // and so on. `toResponse` used to cherry-pick only `Link`; this pins that
    // the rest of the header map survives the round trip too.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: '"abc123"'
        }
      })) as typeof fetch;

    const provider = isolatedProvider();
    const res = await provider.restRequest('GET', '/repos/acme/repo');

    expect(res.headers.get('etag')).toBe('"abc123"');
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  test('restRequest throws a clear error rather than silently corrupting the URL when a GET carries a body', async () => {
    // Octokit routes non-route-variable params into the query string for
    // GET/HEAD instead of rejecting them, so a body would previously produce
    // a request for `?data=%5Bobject%20Object%5D` -- a silently wrong
    // request. The pre-Octokit bare `fetch` threw
    // `TypeError: Request with GET/HEAD method cannot have body`; this
    // restores that loudness with a message naming the method.
    const urls = stubFetch(() => jsonResponse({}));

    const provider = isolatedProvider();

    await expect(
      provider.restRequest('GET', '/repos/acme/repo', { some: 'data' })
    ).rejects.toThrow(/GET cannot have a body/);
    expect(urls).toHaveLength(0);
  });

  test('a transport-level failure (fetch rejects) propagates the original error rather than a synthetic 500', async () => {
    // Octokit's fetch wrapper turns a network-level throw into a
    // RequestError(message, 500, { request }) with no `response`. Turning
    // that into a fabricated 500 Response would hand callers that branch on
    // `res.ok` a dropped connection dressed as an HTTP result, which is how
    // a network failure mid-pagination used to read as "no more pages" and
    // silently truncate instead of surfacing.
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    }) as typeof fetch;

    const provider = isolatedProvider();

    let caught: unknown;
    try {
      // DELETE is non-idempotent, so this fails on the first attempt
      // instead of running through the retry plugin's GET-only backoff,
      // which is not what this test is checking.
      await provider.restRequest('DELETE', '/repos/acme/repo/git/refs/heads/x');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).response).toBeUndefined();
    expect((caught as RequestError).status).toBe(500);
  });

  test('validateToken keeps its original failure wording, including statusText', async () => {
    // The message shape here predates `ghError` and the live harness
    // pattern-matches on it: `${op} failed: ${status} ${statusText}`, no
    // body. A prior pass through this migration accidentally rerouted it
    // through `ghError`'s default (plain) style, which reads
    // `validateToken failed: 401 <body>` -- same information, different
    // wording -- so this pins the exact string rather than just a substring.
    stubFetch(() => jsonResponse({ message: 'Bad credentials' }, 401));

    const provider = isolatedProvider('https://github.com', 'bad-tok');

    await expect(provider.validateToken()).rejects.toThrow(
      /^GitHub token validation failed: 401 Unauthorized$/
    );
  });

  test('a transport-level validateToken failure propagates the original error, not a translated one', async () => {
    // Mirrors the transport-level restRequest case above: no `.response`
    // means this never reached an HTTP outcome, so it must come out as the
    // original `RequestError` (with `.status`/`.request` intact), not a
    // plain `Error` laundered through a message-building helper. Unlike that
    // restRequest case, `validateToken` always issues a GET, which the retry
    // plugin's default 3-retry, quadratic backoff (see
    // `@octokit/plugin-retry`'s `error-request.js`) does not skip -- only
    // non-idempotent verbs get `retries: 0` from the `before` hook in
    // `githubClient.ts`, and `validateToken` cannot pass request options to
    // opt out the way a DELETE-based test can. What this test verifies is the
    // untouched-error propagation, not the backoff timing, so the backoff
    // itself is collapsed via `withInstantTimers` rather than paid for.
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    }) as typeof fetch;

    const provider = isolatedProvider();

    let caught: unknown;
    await withInstantTimers(async () => {
      try {
        await provider.validateToken();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).response).toBeUndefined();
  });

  test('search queries encode colons in the qualifiers, not raw', async () => {
    // searchPRs's only defense against Octokit's `:word` -> `{word}`
    // placeholder rewrite is `encodeURIComponent(qualifiers)` before the
    // query is spliced into the route string. `gh-fetch-prs.test.ts`'s
    // `searchQueries()` helper decodes the recorded path before asserting on
    // it, so removing that `encodeURIComponent` call would leave every
    // unit-test assertion green while every real search went out with a
    // `:` Octokit's parser rewrites into an empty placeholder -- the exact
    // shape of bug Task 2 fixed at the `head=owner:branch` call site,
    // recurring here undefended. Only a test against the real transport
    // (this file stubs `fetch`, not `octokit.request`) can catch it.
    //
    // `fetchPullRequests()` issues three involvement searches, and the
    // throttling plugin's `search` Bottleneck group enforces a real
    // `minTime` between them (see `@octokit/plugin-throttling`'s
    // `index.js`) to respect GitHub's search rate limit -- a real delay this
    // test has no interest in paying for, since it is checking the query
    // string, not the pacing between requests.
    const urls = stubFetch(() => jsonResponse({ items: [] }));

    const provider = isolatedProvider();
    await withInstantTimers(() => provider.fetchPullRequests());

    const searchCall = urls.find(u => u.includes('/search/issues'));
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain('is%3Apr');
    expect(searchCall).toContain('author%3A%40me');
  });

  test('createPullRequest names the sub-operation and the created PR number when reviewers 422s', async () => {
    // The create POST succeeds (the PR exists on GitHub by this point), then
    // the reviewers sub-request 422s -- a live case (requesting yourself, or
    // a non-collaborator). Before this fix, the thrown message was
    // `createPullRequest failed: 422 ...`, indistinguishable from "no PR was
    // created," which would send a caller who retries straight into GitHub's
    // own "a pull request already exists" 422. The op label now names the
    // sub-operation and the PR number so a caller can find #7 instead.
    //
    // Both requests here land in Octokit's real "write" throttle group
    // (`@octokit/plugin-throttling`'s `groups.write`, `minTime: 1000`), a
    // real, non-retry pacing delay between writes that only exists because
    // this file drives the real transport. `withInstantTimers` collapses it;
    // the assertion is about the thrown message, not the pacing.
    stubFetch(url => {
      if (url.endsWith('/pulls')) {
        return jsonResponse({ number: 7, node_id: 'PR_7' }, 201);
      }
      if (url.includes('/requested_reviewers')) {
        return jsonResponse({ message: 'Review cannot be requested from pull request author' }, 422);
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const provider = isolatedProvider();

    await withInstantTimers(() =>
      expect(
        provider.createPullRequest({
          projectPath: 'acme/repo',
          title: 'My feature',
          sourceBranch: 'feat',
          targetBranch: 'main',
          reviewers: ['octocat']
        })
      ).rejects.toThrow(/^Created PR #7 but could not apply reviewers: createPullRequest reviewers for #7 failed: 422 /)
    );
  });

  test('updatePullRequest names the sub-operation and the PR number when labels 422s', async () => {
    // Mirrors the createPullRequest case above, on the update path: the
    // PATCH has already landed (title/base/state, whichever were sent) by
    // the time the labels sub-request fails, so the thrown message must not
    // read as "nothing happened." Same real write-throttle pacing between
    // the two requests as above, collapsed the same way.
    stubFetch(url => {
      if (/\/pulls\/9$/.test(url)) {
        return jsonResponse({ number: 9, node_id: 'PR_9', draft: false }, 200);
      }
      if (url.includes('/issues/9/labels')) {
        return jsonResponse({ message: 'Label does not exist' }, 422);
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const provider = isolatedProvider();

    await withInstantTimers(() =>
      expect(
        provider.updatePullRequest('acme/repo', 9, { labels: ['no-such-label'] })
      ).rejects.toThrow(/^updatePullRequest labels for #9 failed: 422 /)
    );
  });

  test('a transport-level failure on a PR write sub-request keeps the original RequestError as the step cause', async () => {
    // Same shape as the restRequest and validateToken transport-failure
    // cases above: no `.response` means this never reached an HTTP outcome,
    // so the failed step must carry the original `RequestError`, not translated
    // through `ghError` into a plain `Error` that has lost `.status` and
    // `.request`. The create POST succeeds; the assignees sub-request is
    // what drops the connection. The assignees POST is non-idempotent, so
    // the retry hook's `retries: 0` applies and this fails on the first
    // attempt with no real retry wait; `withInstantTimers` is only needed
    // here for the same real write-throttle pacing the two tests above hit
    // between the create POST and the assignees POST.
    let call = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      call++;
      if (url.endsWith('/pulls')) {
        return jsonResponse({ number: 3, node_id: 'PR_3' }, 201);
      }
      if (url.includes('/assignees')) {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      }
      throw new Error(`unexpected URL in test (call ${call}): ${url}`);
    }) as typeof fetch;

    const provider = isolatedProvider();

    let caught: unknown;
    await withInstantTimers(async () => {
      try {
        await provider.createPullRequest({
          projectPath: 'acme/repo',
          title: 'My feature',
          sourceBranch: 'feat',
          targetBranch: 'main',
          assignees: ['octocat']
        });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(PartialCreateError);
    const step = (caught as PartialCreateError).failedSteps[0];
    expect(step?.step).toBe('assignees');
    expect(step?.cause).toBeInstanceOf(RequestError);
    expect((step?.cause as RequestError).response).toBeUndefined();
  });

  test('every request carries the X-GitHub-Api-Version pin', async () => {
    // The hand-rolled fetch transport this replaced sent
    // `X-GitHub-Api-Version: 2022-11-28` on every request, protecting this
    // SDK against a future GitHub REST version bump. Octokit does not send
    // this on its own; `createGitHubClient` restores it as an
    // instance-level default header, which Octokit merges into every
    // request. Captured here as a real Request header reaching fetch, not
    // just as options Octokit was configured with.
    let seenHeaders: Headers | undefined;
    globalThis.fetch = (async (
      _input: string | URL | Request,
      init?: RequestInit
    ) => {
      seenHeaders = new Headers(init?.headers);
      return jsonResponse([]);
    }) as typeof fetch;

    const provider = isolatedProvider();
    await provider.restRequest('GET', '/repos/acme/repo');

    expect(seenHeaders?.get('x-github-api-version')).toBe('2022-11-28');
  });

  test('an absolute URL passed to restRequest reaches fetch unmangled', async () => {
    // A blanket colon-escape would rewrite the scheme separator too:
    // `https://...` becomes `https%3A//...`, which still passes Octokit's
    // `/^http/` check (see @octokit/endpoint/dist-src/parse.js) so no
    // baseUrl gets prepended, and fetch then receives a malformed URL. This
    // path is live because `restRequest` is documented to accept an
    // absolute URL.
    const urls = stubFetch(() => jsonResponse([]));

    const provider = isolatedProvider();
    await provider.restRequest('GET', 'https://api.github.com/repos/acme/repo/pulls?page=2');

    expect(urls).toEqual(['https://api.github.com/repos/acme/repo/pulls?page=2']);
  });
});

/**
 * The repository listing's approvals over the real transport. Reviews no
 * longer page through REST: the listing names the PRs and one GraphQL fill
 * carries every PR's reviews, so what this pins is that approvals arrive
 * complete from that one POST, and that a failed fill drops the PR rather
 * than presenting it with a partial approval count.
 */
describe('GitHubProvider transport: listing approvals arrive through the fill', () => {
  const LIST_URL = 'https://api.github.com/repos/acme/repo/pulls?state=open';
  const GRAPHQL_URL = 'https://api.github.com/graphql';

  function approval(login: string, databaseId: number) {
    return {
      state: 'APPROVED',
      submittedAt: '2026-07-01T00:00:00Z',
      author: { __typename: 'User' as const, login, avatarUrl: null, databaseId, name: null }
    };
  }

  function listing() {
    return jsonResponse([
      {
        number: 5,
        state: 'open',
        merged_at: null,
        updated_at: '2026-07-10T00:00:00Z',
        base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' } }
      }
    ]);
  }

  test('two approvers both count, read from one fill POST', async () => {
    const reviews = { nodes: [approval('bob', 1), approval('carol', 2)] };
    const urls = stubFetch(url => {
      if (url.startsWith(LIST_URL)) return listing();
      if (url === GRAPHQL_URL) {
        return jsonResponse({
          data: {
            repository: {
              p5: ghNode({ number: 5, latestReviews: reviews, latestOpinionatedReviews: reviews })
            }
          }
        });
      }
      return jsonResponse({ message: 'Not Found' }, 404);
    });

    const provider = isolatedProvider();
    const prs = await withInstantTimers(() =>
      provider.fetchPullRequests({ projectPath: 'acme/repo', listWeight: true })
    );

    expect(prs[0]?.approvedBy.map(u => u.username).sort()).toEqual(['bob', 'carol']);
    expect(urls.filter(u => u === GRAPHQL_URL)).toHaveLength(1);
    expect(urls.some(u => u.includes('/reviews'))).toBe(false);
  });

  test('a failed fill drops the PR and reports why, not a partial approval count', async () => {
    stubFetch(url => {
      if (url.startsWith(LIST_URL)) return listing();
      // A plain 403 with no rate-limit-shaped message or headers: in the
      // retry plugin's `doNotRetry` list, so it surfaces on the first attempt.
      if (url === GRAPHQL_URL) return jsonResponse({ message: 'fill unavailable' }, 403);
      return jsonResponse({ message: 'Not Found' }, 404);
    });

    const provider = isolatedProvider();
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await withInstantTimers(() =>
      provider.fetchPullRequests({
        projectPath: 'acme/repo',
        listWeight: true,
        onWarning: w => warnings.push(w)
      })
    );

    expect(prs).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'fill',
      status: 403,
      target: 'acme/repo#5'
    });
  });
});

describe('GitHubProvider transport: GraphQL endpoint resolution (real octokit.graphql)', () => {
  /**
   * `octokit.graphql` derives its endpoint from the client's REST `baseUrl`.
   * `@octokit/graphql` detects a `/api/v3` suffix (GHES) and rewrites it to
   * `/api/graphql` itself (see `GHES_V3_SUFFIX_REGEX` in
   * `@octokit/graphql/dist-src/graphql.js`); for github.com's
   * `https://api.github.com` base it appends the default `/graphql`. Both
   * must be proven by URL, since no other fixture exercises a GHES host.
   */
  test('github.com sends the GraphQL request to https://api.github.com/graphql', async () => {
    const urls = stubFetch(() => jsonResponse({ data: { ok: true } }));

    const provider = isolatedProvider();
    const data = await withInstantTimers(() =>
      (provider as any).graphqlOrThrow('probe', 'query { viewer { login } }', {})
    );

    expect(urls).toEqual(['https://api.github.com/graphql']);
    expect(data).toEqual({ ok: true });
  });

  test('a GitHub Enterprise host sends the GraphQL request under /api/graphql, not /api/v3', async () => {
    const urls = stubFetch(() => jsonResponse({ data: { ok: true } }));

    const provider = isolatedProvider('https://ghe.corp.example');
    const data = await withInstantTimers(() =>
      (provider as any).graphqlOrThrow('probe', 'query { viewer { login } }', {})
    );

    expect(urls).toEqual(['https://ghe.corp.example/api/graphql']);
    expect(data).toEqual({ ok: true });
  });
});

describe('GitHubProvider transport: a GraphQL rate limit is not retried', () => {
  /**
   * `@octokit/plugin-throttling` treats a `RATE_LIMITED` GraphQL error or a
   * secondary-rate-limit 403 as retryable, which would wait out the reset in
   * real time before the caller saw anything. `createGitHubClient` declines
   * both for a GraphQL request, so each fails after exactly one fetch.
   */
  test('a 200 reporting a RATE_LIMITED GraphQL error fails after exactly one fetch', async () => {
    const resetInTwoHours = Math.floor(Date.now() / 1000) + 7200;
    const urls = stubFetch(() =>
      new Response(
        JSON.stringify({
          data: null,
          errors: [
            { type: 'RATE_LIMITED', message: 'API rate limit exceeded for installation.' }
          ]
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetInTwoHours)
          }
        }
      )
    );

    const provider = isolatedProvider();
    await expect(
      withInstantTimers(() =>
        (provider as any).graphqlOrThrow('probe', 'query { viewer { login } }', {})
      )
    ).rejects.toThrow(/API rate limit exceeded for installation/);

    expect(urls).toHaveLength(1);
  });

  test('a 403 secondary rate limit fails after exactly one fetch, not a real 30-120s wait', async () => {
    const urls = stubFetch(() =>
      new Response(
        JSON.stringify({
          message: 'You have exceeded a secondary rate limit. Please wait a few minutes.'
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json', 'retry-after': '30' }
        }
      )
    );

    const provider = isolatedProvider();
    await expect(
      withInstantTimers(() =>
        (provider as any).graphqlOrThrow('probe', 'query { viewer { login } }', {})
      )
    ).rejects.toThrow(/403/);

    expect(urls).toHaveLength(1);
  });
});

describe('GitHubProvider transport: GraphQL detection matches pathname, not substring', () => {
  /**
   * The interpolated request URL a rate-limit hook sees is not a route
   * template -- `GET /repos/{owner}/{repo}/pulls` has already become
   * `/repos/graphql/graphql-js/pulls` by the time `isGraphQLRequest` runs.
   * A plain `.includes('/graphql')` check would misread any REST path
   * containing that substring as GraphQL: the real `graphql` GitHub org and
   * its `graphql-js` repo, any repository or branch literally named
   * "graphql", or a caller-supplied `restRequest` path. These tests pin
   * both directions: REST paths that merely contain "graphql" must still
   * get the REST rate-limit retry Octokit was adopted for, and both real
   * GraphQL endpoints (github.com and GHES) must still be recognized so a
   * GraphQL rate limit still fails promptly on them.
   */
  function rateLimited403(): Response {
    return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '0',
        // Inside the 30s retry deadline: a reset further out fails fast
        // instead of retrying, which is not what these tests pin.
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 5)
      }
    });
  }

  test('a REST path containing "graphql" as a path segment still gets the REST rate-limit retry (3 fetches)', async () => {
    // The real GitHub org + repo this collision is not theoretical for.
    const urls = stubFetch(() => rateLimited403());
    const provider = isolatedProvider();

    const res = await withInstantTimers(() =>
      provider.restRequest('GET', '/repos/graphql/graphql-js/pulls')
    );

    // retryCount < 2 means two retries beyond the first attempt.
    expect(urls).toHaveLength(3);
    expect(res.status).toBe(403);
  });

  test('a branch literally named "graphql" still gets the REST rate-limit retry (3 fetches)', async () => {
    const urls = stubFetch(() => rateLimited403());
    const provider = isolatedProvider();

    const res = await withInstantTimers(() =>
      provider.restRequest('GET', '/repos/acme/repo/git/refs/heads/graphql')
    );

    expect(urls).toHaveLength(3);
    expect(res.status).toBe(403);
  });

  test('an ordinary REST path retries identically (3 fetches), as the control for the two tests above', async () => {
    const urls = stubFetch(() => rateLimited403());
    const provider = isolatedProvider();

    const res = await withInstantTimers(() =>
      provider.restRequest('GET', '/repos/acme/repo/pulls')
    );

    expect(urls).toHaveLength(3);
    expect(res.status).toBe(403);
  });

  test('the real GraphQL endpoint on github.com still fails immediately under a rate limit (1 fetch)', async () => {
    const urls = stubFetch(() => rateLimited403());
    const provider = isolatedProvider();

    await expect(
      withInstantTimers(() =>
        (provider as any).graphqlOrThrow('probe', 'query { viewer { login } }', {})
      )
    ).rejects.toThrow(/403/);

    expect(urls).toHaveLength(1);
  });

  test('the real GraphQL endpoint on a GHES host still fails immediately under a rate limit (1 fetch)', async () => {
    // GHES's rewritten GraphQL URL is absolute (`.../api/graphql`), unlike
    // github.com's relative `/graphql` -- both forms must resolve to the
    // same pathname check.
    const urls = stubFetch(() => rateLimited403());
    const provider = isolatedProvider('https://ghe.corp.example');

    await expect(
      withInstantTimers(() =>
        (provider as any).graphqlOrThrow('probe', 'query { viewer { login } }', {})
      )
    ).rejects.toThrow(/403/);

    expect(urls).toHaveLength(1);
  });
});
