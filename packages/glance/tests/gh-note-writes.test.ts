import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { ForgeHttpError, RateLimitedError, WriteOutcomeUnknownError } from '../src/errors.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Route = (method: string, path: string, body: unknown) => Response | undefined;

/** Records every REST request as method, path and parsed JSON body. */
function forge(route: Route): Call[] {
  const calls: Call[] = [];
  stubForge({
    rest: (url, method, raw) => {
      const path = new URL(url).pathname;
      const body = raw === undefined ? undefined : JSON.parse(raw);
      calls.push({ method, path, body });
      return route(method, path, body);
    }
  });
  return calls;
}

let tokens = 0;
function provider(options: { writeTimeoutMs?: number } = {}): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-note-writes-${++tokens}`, options);
}

const REPO = '/repos/o/r';

describe('GitHub createComment', () => {
  test('posts an issue comment that is never resolvable', async () => {
    const calls = forge(() => jsonResponse({ id: 101, html_url: 'https://github.com/o/r/pull/7#issuecomment-101' }, 201));
    const out = await provider().createComment('o/r', 7, 'hello', { resolvable: true });
    expect(calls).toEqual([{ method: 'POST', path: `${REPO}/issues/7/comments`, body: { body: 'hello' } }]);
    expect(out).toEqual({
      noteId: 101,
      discussionId: 'gh-issue-comment-101',
      resolvable: false,
      url: 'https://github.com/o/r/pull/7#issuecomment-101'
    });
  });

  test('a 502 on the POST rejects with the may-have-landed message after exactly one request', async () => {
    const calls = forge(() => jsonResponse({ message: 'Bad Gateway' }, 502));
    const err = await provider().createComment('o/r', 7, 'hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteOutcomeUnknownError);
    expect((err as WriteOutcomeUnknownError).reason).toBe('server-error');
    expect((err as Error).message).toBe(
      'createComment got a 502 Bad Gateway from GitHub (Bad Gateway): GitHub may still have applied it; check the pull request before retrying'
    );
    expect(((err as Error).cause as ForgeHttpError).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  test('a 4xx on the POST still rejects with ForgeHttpError', async () => {
    const calls = forge(() => jsonResponse({ message: 'Not Found' }, 404));
    const err = await provider().createComment('o/r', 7, 'hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  test('a POST that outlives writeTimeoutMs rejects with the may-have-landed message after one request', async () => {
    let requests = 0;
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requests++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as typeof fetch;
    const err = await provider({ writeTimeoutMs: 50 })
      .createComment('o/r', 7, 'hello')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteOutcomeUnknownError);
    expect((err as WriteOutcomeUnknownError).reason).toBe('timed-out');
    expect((err as Error).message).toBe(
      'createComment timed out: GitHub may still have applied it; check the pull request before retrying'
    );
    expect(requests).toBe(1);
  });

  test('a POST whose answer is lost rejects with the may-have-landed message after one request', async () => {
    let requests = 0;
    globalThis.fetch = (() => {
      requests++;
      return Promise.reject(new TypeError('socket hang up'));
    }) as unknown as typeof fetch;
    const err = await provider().createComment('o/r', 7, 'hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteOutcomeUnknownError);
    expect((err as WriteOutcomeUnknownError).reason).toBe('no-answer');
    expect((err as Error).message).toContain('createComment got no answer from GitHub');
    expect((err as Error).message).toContain('GitHub may still have applied it; check the pull request before retrying');
    expect(requests).toBe(1);
  });

  test('a rate limit becomes RateLimitedError', async () => {
    forge(() =>
      jsonResponse({ message: 'API rate limit exceeded' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000))
      })
    );
    const err = await provider().createComment('o/r', 7, 'hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
  });
});

describe('GitHub createInlineComment', () => {
  function inlineRoutes(): Route {
    return (method, path) => {
      if (method === 'GET' && path === `${REPO}/pulls/7`) return jsonResponse({ number: 7, head: { sha: 'abc' } });
      if (method === 'POST' && path === `${REPO}/pulls/7/comments`)
        return jsonResponse({ id: 202, html_url: 'https://github.com/o/r/pull/7#discussion_r202' }, 201);
      return undefined;
    };
  }

  test('a new line goes on the RIGHT side at the head commit', async () => {
    const calls = forge(inlineRoutes());
    const out = await provider().createInlineComment('o/r', 7, 'look', { path: 'a.ts', line: 4, oldLine: 3 });
    expect(calls).toEqual([
      { method: 'GET', path: `${REPO}/pulls/7`, body: undefined },
      {
        method: 'POST',
        path: `${REPO}/pulls/7/comments`,
        body: { body: 'look', commit_id: 'abc', path: 'a.ts', line: 4, side: 'RIGHT' }
      }
    ]);
    expect(out).toEqual({
      noteId: 202,
      discussionId: 'gh-review-thread-202',
      resolvable: true,
      url: 'https://github.com/o/r/pull/7#discussion_r202',
      anchored: true,
      noteType: 'DiffNote'
    });
  });

  test('an old line alone goes on the LEFT side at that line', async () => {
    const calls = forge(inlineRoutes());
    await provider().createInlineComment('o/r', 7, 'gone', { path: 'a.ts', oldLine: 9 });
    expect(calls[1]!.body).toEqual({ body: 'gone', commit_id: 'abc', path: 'a.ts', line: 9, side: 'LEFT' });
  });

  test('a head read that outlives writeTimeoutMs rejects without posting', async () => {
    const methods: string[] = [];
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      methods.push(String(init?.method ?? 'GET').toUpperCase());
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as typeof fetch;
    const err = await provider({ writeTimeoutMs: 50 })
      .createInlineComment('o/r', 7, 'look', { path: 'a.ts', line: 4 })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "createInlineComment timed out reading the pull request's head commit; nothing was posted"
    );
    expect(methods).toEqual(['GET']);
  });

  test("a 422 carrying object-shaped errors surfaces each entry's message", async () => {
    forge((method, path) => {
      if (method === 'GET') return jsonResponse({ number: 7, head: { sha: 'abc' } });
      if (path === `${REPO}/pulls/7/comments`)
        return jsonResponse(
          {
            message: 'Validation Failed',
            errors: [
              {
                resource: 'PullRequestReviewComment',
                code: 'custom',
                field: 'pull_request_review_thread.line',
                message: 'pull_request_review_thread.line must be part of the diff'
              }
            ]
          },
          422
        );
      return undefined;
    });
    const err = await provider()
      .createInlineComment('o/r', 7, 'look', { path: 'a.ts', line: 400 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).message).toContain('must be part of the diff');
    expect((err as ForgeHttpError).bodyText).toBe(
      'Validation Failed; pull_request_review_thread.line must be part of the diff'
    );
  });
});

describe('GitHub replyToDiscussion', () => {
  test('replies inside a review thread', async () => {
    const calls = forge(() => jsonResponse({ id: 303, html_url: 'https://github.com/o/r/pull/7#discussion_r303' }, 201));
    const out = await provider().replyToDiscussion('o/r', 7, 'gh-review-thread-9', 'agreed');
    expect(calls).toEqual([
      { method: 'POST', path: `${REPO}/pulls/7/comments/9/replies`, body: { body: 'agreed' } }
    ]);
    expect(out).toEqual({
      noteId: 303,
      discussionId: 'gh-review-thread-9',
      resolvable: true,
      url: 'https://github.com/o/r/pull/7#discussion_r303'
    });
  });

  test('a pull request comment is refused before any request', async () => {
    const calls = forge(() => jsonResponse({}, 201));
    await expect(provider().replyToDiscussion('o/r', 7, 'gh-issue-comment-5', 'agreed')).rejects.toThrow(
      'replyToDiscussion: gh-issue-comment-5 is a pull request comment with no thread on GitHub; post a new comment instead'
    );
    expect(calls).toHaveLength(0);
  });

  test('a review summary is refused before any request', async () => {
    const calls = forge(() => jsonResponse({}, 201));
    await expect(provider().replyToDiscussion('o/r', 7, 'gh-review-9', 'agreed')).rejects.toThrow(
      'replyToDiscussion: gh-review-9 is a review summary with no thread on GitHub; post a new comment instead'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('GitHub updateComment and deleteComment', () => {
  test('a known kind goes straight to its endpoint', async () => {
    const calls = forge(() => jsonResponse({}));
    const p = provider();
    await p.updateComment('o/r', 7, { id: 5, kind: 'diff' }, 'v2');
    await p.updateComment('o/r', 7, { id: 5, kind: 'general' }, 'v2');
    await p.updateComment('o/r', 7, { id: 5, kind: 'review' }, 'v2');
    expect(calls).toEqual([
      { method: 'PATCH', path: `${REPO}/pulls/comments/5`, body: { body: 'v2' } },
      { method: 'PATCH', path: `${REPO}/issues/comments/5`, body: { body: 'v2' } },
      { method: 'PUT', path: `${REPO}/pulls/7/reviews/5`, body: { body: 'v2' } }
    ]);
  });

  test('delete goes to the matching endpoint and refuses a review', async () => {
    const calls = forge(() => new Response(null, { status: 204 }));
    const p = provider();
    await p.deleteComment('o/r', 7, { id: 5, kind: 'diff' });
    await p.deleteComment('o/r', 7, { id: 6, kind: 'general' });
    await expect(p.deleteComment('o/r', 7, { id: 8, kind: 'review' })).rejects.toThrow(
      'GitHub cannot delete a submitted review'
    );
    expect(calls).toEqual([
      { method: 'DELETE', path: `${REPO}/pulls/comments/5`, body: undefined },
      { method: 'DELETE', path: `${REPO}/issues/comments/6`, body: undefined }
    ]);
  });

  test('with no kind, a diff comment on this pull request is found first', async () => {
    const calls = forge((method, path) => {
      if (method === 'GET' && path === `${REPO}/pulls/comments/5`)
        return jsonResponse({ id: 5, pull_request_url: 'https://api.github.com/repos/o/r/pulls/7' });
      return jsonResponse({});
    });
    await provider().updateComment('o/r', 7, { id: 5 }, 'v2');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${REPO}/pulls/comments/5`,
      `PATCH ${REPO}/pulls/comments/5`
    ]);
  });

  test('with no kind, a 404 on the diff comment falls back to the pull request comment', async () => {
    const calls = forge((method, path) => {
      if (method === 'GET' && path === `${REPO}/pulls/comments/5`) return jsonResponse({ message: 'Not Found' }, 404);
      if (method === 'GET' && path === `${REPO}/issues/comments/5`)
        return jsonResponse({ id: 5, issue_url: 'https://api.github.com/repos/o/r/issues/7' });
      return jsonResponse({});
    });
    await provider().updateComment('o/r', 7, { id: 5 }, 'v2');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${REPO}/pulls/comments/5`,
      `GET ${REPO}/issues/comments/5`,
      `PATCH ${REPO}/issues/comments/5`
    ]);
  });

  test('with no kind, delete falls back to the pull request comment on a 404', async () => {
    const calls = forge((method, path) => {
      if (method === 'GET' && path === `${REPO}/pulls/comments/5`) return jsonResponse({ message: 'Not Found' }, 404);
      if (method === 'GET' && path === `${REPO}/issues/comments/5`)
        return jsonResponse({ id: 5, issue_url: 'https://api.github.com/repos/o/r/issues/7' });
      return new Response(null, { status: 204 });
    });
    await provider().deleteComment('o/r', 7, { id: 5 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${REPO}/pulls/comments/5`,
      `GET ${REPO}/issues/comments/5`,
      `DELETE ${REPO}/issues/comments/5`
    ]);
  });

  test('with no kind, a comment on another pull request is refused with no write', async () => {
    const calls = forge((method, path) => {
      if (method === 'GET' && path === `${REPO}/pulls/comments/5`)
        return jsonResponse({ id: 5, pull_request_url: 'https://api.github.com/repos/o/r/pulls/8' });
      return jsonResponse({});
    });
    await expect(provider().updateComment('o/r', 7, { id: 5 }, 'v2')).rejects.toThrow(
      'comment 5 belongs to another pull request'
    );
    await expect(provider().deleteComment('o/r', 7, { id: 5 })).rejects.toThrow(
      'comment 5 belongs to another pull request'
    );
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  test('with no kind, a comment found on neither endpoint is refused', async () => {
    const calls = forge(() => jsonResponse({ message: 'Not Found' }, 404));
    await expect(provider().updateComment('o/r', 7, { id: 5 }, 'v2')).rejects.toThrow('no comment 5 on o/r#7');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  test('a 422 with string errors appends them to the detail', async () => {
    forge(() =>
      jsonResponse({ message: 'Unprocessable Entity', errors: ['Can not approve your own pull request'] }, 422)
    );
    const err = await provider()
      .updateComment('o/r', 7, { id: 5, kind: 'review' }, 'v2')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).bodyText).toBe('Unprocessable Entity; Can not approve your own pull request');
  });
});
