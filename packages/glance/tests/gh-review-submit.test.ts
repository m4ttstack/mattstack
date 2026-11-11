import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { ReviewSubmission } from '../src/types.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Route = (method: string, path: string, body: unknown) => Response | undefined;

const REPO = '/repos/o/r';
const OWN_PR_422 = { message: 'Unprocessable Entity', errors: ['Can not approve your own pull request'] };
const LINE_422 = { message: 'Unprocessable Entity', errors: ['Line could not be resolved'] };

function thread(root: number) {
  return { id: `PRRT_${root}`, isResolved: false, comments: { nodes: [{ databaseId: root }] } };
}

/**
 * Records REST requests as method, path and body, and GraphQL requests as
 * `GRAPHQL query` or `GRAPHQL mutation` with the variables as body. Review
 * threads 9 and 10 exist and resolve.
 */
function forge(route: Route): Call[] {
  const calls: Call[] = [];
  stubForge({
    rest: (url, method, raw) => {
      const path = new URL(url).pathname;
      const body = raw === undefined ? undefined : JSON.parse(raw);
      calls.push({ method, path, body });
      return route(method, path, body);
    },
    graphql: (query, variables) => {
      const mutation = query.trimStart().startsWith('mutation');
      calls.push({ method: 'GRAPHQL', path: mutation ? 'mutation' : 'query', body: variables });
      if (mutation) return { resolveReviewThread: { thread: { id: variables.threadId, isResolved: true } } };
      return {
        repository: {
          pullRequest: {
            reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [thread(9), thread(10)] }
          }
        }
      };
    }
  });
  return calls;
}

/** No pending review; review POSTs answer in `posts` order; replies succeed. */
function routes(...posts: Response[]): Route {
  return (method, path) => {
    if (method === 'GET' && path === `${REPO}/pulls/7/reviews`) return jsonResponse([]);
    if (method === 'POST' && path === `${REPO}/pulls/7/reviews`) return posts.shift();
    const reply = /\/pulls\/7\/comments\/(\d+)\/replies$/.exec(path);
    if (method === 'POST' && reply)
      return jsonResponse({ id: 500 + Number(reply[1]), html_url: `https://github.com/o/r/pull/7#discussion_r5${reply[1]}` }, 201);
    return undefined;
  };
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === `${REPO}/pulls/7/reviews`);

let tokens = 0;
function provider(options: { reviewTimeoutMs?: number } = {}): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-review-submit-${++tokens}`, options);
}

const COMMENTS: ReviewSubmission['comments'] = [
  { body: 'new side', path: 'a.ts', line: 4, oldLine: 3 },
  { body: 'old side', path: 'b.ts', oldLine: 8 }
];

const REVIEW: ReviewSubmission = {
  outcome: 'comment',
  summary: 'sum',
  comments: COMMENTS,
  replies: [{ discussionId: 'gh-review-thread-9', body: 'agreed', resolve: true }]
};

describe('GitHub submitReview', () => {
  test('lists reviews, posts one review, replies, then resolves through the GraphQL pair', async () => {
    const calls = forge(routes(jsonResponse({ id: 900, state: 'COMMENTED' })));
    const out = await provider().submitReview('o/r', 7, REVIEW);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${REPO}/pulls/7/reviews`,
      `POST ${REPO}/pulls/7/reviews`,
      `POST ${REPO}/pulls/7/comments/9/replies`,
      'GRAPHQL query',
      'GRAPHQL mutation'
    ]);
    expect(calls[1]!.body).toEqual({
      body: 'sum',
      event: 'COMMENT',
      comments: [
        { path: 'a.ts', body: 'new side', line: 4, side: 'RIGHT' },
        { path: 'b.ts', body: 'old side', line: 8, side: 'LEFT' }
      ]
    });
    expect(calls[2]!.body).toEqual({ body: 'agreed' });
    expect(calls[4]!.body).toEqual({ threadId: 'PRRT_9' });
    expect(out).toEqual({
      published: true,
      comments: 2,
      replies: 1,
      repliedTo: ['gh-review-thread-9'],
      resolved: ['gh-review-thread-9'],
      approved: false,
      resolveErrors: [],
      reviewId: 900,
      reviewerState: 'reviewed'
    });
  });

  test('approve and request_changes send their events and map the review state', async () => {
    const calls = forge(
      routes(jsonResponse({ id: 901, state: 'APPROVED' }), jsonResponse({ id: 902, state: 'CHANGES_REQUESTED' }))
    );
    const p = provider();
    const approved = await p.submitReview('o/r', 7, { ...REVIEW, outcome: 'approve', replies: [] });
    const changes = await p.submitReview('o/r', 7, { ...REVIEW, outcome: 'request_changes', replies: [] });
    expect(posts(calls).map((c) => (c.body as { event: string }).event)).toEqual(['APPROVE', 'REQUEST_CHANGES']);
    expect(approved).toMatchObject({ published: true, approved: true, reviewId: 901, reviewerState: 'approved' });
    expect(changes).toMatchObject({
      published: true,
      approved: false,
      reviewId: 902,
      reviewerState: 'requested_changes'
    });
  });

  test("the token's own pending review returns pending-drafts with zero writes", async () => {
    const calls = forge((method, path) => {
      if (path === `${REPO}/pulls/7/reviews`)
        return jsonResponse([
          { id: 54, state: 'APPROVED', body: '' },
          { id: 55, state: 'PENDING', body: 'draft summary' }
        ]);
      if (path === `${REPO}/pulls/7/reviews/55/comments`)
        return jsonResponse([{ body: '\nhalf a thought\nsecond line' }, { body: 'another' }]);
      return undefined;
    });
    const out = await provider().submitReview('o/r', 7, REVIEW);
    expect(out).toEqual({
      published: false,
      reason: 'pending-drafts',
      pending: { count: 2, firstLines: ['half a thought', 'another'] }
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${REPO}/pulls/7/reviews`,
      `GET ${REPO}/pulls/7/reviews/55/comments`
    ]);
  });

  test('a pending review with no comments counts as one and previews its body', async () => {
    forge((_method, path) => {
      if (path === `${REPO}/pulls/7/reviews`) return jsonResponse([{ id: 55, state: 'PENDING', body: 'draft summary' }]);
      if (path === `${REPO}/pulls/7/reviews/55/comments`) return jsonResponse([]);
      return undefined;
    });
    const out = await provider().submitReview('o/r', 7, REVIEW);
    expect(out).toEqual({
      published: false,
      reason: 'pending-drafts',
      pending: { count: 1, firstLines: ['draft summary'] }
    });
  });

  test('a reply to anything but a review thread is refused before any request', async () => {
    const calls = forge(routes(jsonResponse({ id: 900, state: 'COMMENTED' })));
    await expect(
      provider().submitReview('o/r', 7, {
        ...REVIEW,
        replies: [
          { discussionId: 'gh-review-thread-9', body: 'ok', resolve: false },
          { discussionId: 'gh-issue-comment-5', resolve: true }
        ]
      })
    ).rejects.toThrow(
      'review not posted: replies[1]: gh-issue-comment-5 has no thread on GitHub; post a new comment instead'
    );
    expect(calls).toHaveLength(0);
  });

  test('an approve refused on your own pull request posts once more as a comment', async () => {
    const calls = forge(
      routes(jsonResponse(OWN_PR_422, 422), jsonResponse({ id: 903, state: 'COMMENTED' }))
    );
    const out = await provider().submitReview('o/r', 7, { ...REVIEW, outcome: 'approve', replies: [] });
    expect(posts(calls).map((c) => (c.body as { event: string }).event)).toEqual(['APPROVE', 'COMMENT']);
    expect(out.published && out.approved).toBe(false);
    expect(out.published && out.approveError).toContain('own pull request');
    expect(out).toMatchObject({ reviewId: 903, reviewerState: 'reviewed' });
  });

  test('request_changes refused on your own pull request throws with no retry', async () => {
    const calls = forge(routes(jsonResponse(OWN_PR_422, 422)));
    await expect(
      provider().submitReview('o/r', 7, { ...REVIEW, outcome: 'request_changes', replies: [] })
    ).rejects.toThrow(/^review not posted: .*Can not approve your own pull request/);
    expect(posts(calls)).toHaveLength(1);
  });

  test('a position 422 returns bad-anchors listing every comment', async () => {
    const calls = forge(routes(jsonResponse(LINE_422, 422)));
    const out = await provider().submitReview('o/r', 7, REVIEW);
    expect(out).toEqual({
      published: false,
      reason: 'bad-anchors',
      badAnchors: [
        { index: 0, path: 'a.ts', line: 4 },
        { index: 1, path: 'b.ts', line: 8 }
      ]
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${REPO}/pulls/7/reviews`,
      `POST ${REPO}/pulls/7/reviews`
    ]);
  });

  test('a position 422 on the comment retry returns bad-anchors after two POSTs', async () => {
    const calls = forge(routes(jsonResponse(OWN_PR_422, 422), jsonResponse(LINE_422, 422)));
    const out = await provider().submitReview('o/r', 7, { ...REVIEW, outcome: 'approve' });
    expect(out).toMatchObject({ published: false, reason: 'bad-anchors' });
    expect(posts(calls)).toHaveLength(2);
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(2);
  });

  test('a 502 on the POST throws after one POST', async () => {
    const calls = forge(routes(jsonResponse({ message: 'Bad Gateway' }, 502)));
    await expect(provider().submitReview('o/r', 7, REVIEW)).rejects.toThrow(/^review not posted: .*502/);
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(1);
  });

  test('a POST that outlives reviewTimeoutMs throws the unknown-outcome message after one POST', async () => {
    let postCount = 0;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') return Promise.resolve(jsonResponse([]));
      postCount++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as typeof fetch;
    const err = await provider({ reviewTimeoutMs: 50 })
      .submitReview('o/r', 7, REVIEW)
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'publish failed and its outcome is unknown: the review request timed out; look at the pull request before retrying'
    );
    expect(postCount).toBe(1);
  });

  test('a failed reply lands in replyErrors and its resolve is skipped', async () => {
    const base = routes(jsonResponse({ id: 900, state: 'COMMENTED' }));
    const calls = forge((method, path, body) => {
      if (path === `${REPO}/pulls/7/comments/9/replies`) return jsonResponse({ message: 'Server Error' }, 500);
      return base(method, path, body);
    });
    const out = await provider().submitReview('o/r', 7, {
      ...REVIEW,
      replies: [
        { discussionId: 'gh-review-thread-9', body: 'a', resolve: true },
        { discussionId: 'gh-review-thread-10', body: 'b', resolve: true }
      ]
    });
    expect(out.published && out.replyErrors).toEqual([
      { discussionId: 'gh-review-thread-9', error: expect.stringContaining('500') }
    ]);
    expect(out.published && out.repliedTo).toEqual(['gh-review-thread-10']);
    expect(out.published && out.replies).toBe(1);
    expect(out.published && out.resolved).toEqual(['gh-review-thread-10']);
    expect(calls.filter((c) => c.path === 'mutation').map((c) => c.body)).toEqual([{ threadId: 'PRRT_10' }]);
  });
});
