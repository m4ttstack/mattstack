import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { WriteOutcomeUnknownError } from '../src/errors.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

type Route = (method: string, path: string) => Response | undefined;

function forge(route: Route, graphql?: (query: string) => unknown): Call[] {
  const calls: Call[] = [];
  stubForge({
    rest: (url, method, raw) => {
      const u = new URL(url);
      calls.push({ method, path: u.pathname, search: u.search, body: raw === undefined ? undefined : JSON.parse(raw) });
      return route(method, u.pathname);
    },
    graphql: graphql ? (query) => graphql(query) : undefined
  });
  return calls;
}

let tokens = 0;
function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-file-comment-${++tokens}`);
}

const REPO = '/repos/o/r';

function routes(files: unknown[], post: () => Response = () =>
  jsonResponse({ id: 404, subject_type: 'file', line: null, path: 'src/a.ts' }, 201)): Route {
  return (method, path) => {
    if (method === 'GET' && path === `${REPO}/pulls/7`) return jsonResponse({ number: 7, head: { sha: 'abc' } });
    if (method === 'GET' && path === `${REPO}/pulls/7/files`) return jsonResponse(files);
    if (method === 'POST' && path === `${REPO}/pulls/7/comments`) return post();
    return undefined;
  };
}

describe('GitHub createFileComment', () => {
  test('posts a file-level thread on the first changed file at the head commit', async () => {
    const calls = forge(routes([{ filename: 'src/a.ts' }]));
    const out = await provider().createFileComment('o/r', 7, 'banner');
    expect(calls).toEqual([
      { method: 'GET', path: `${REPO}/pulls/7`, search: '', body: undefined },
      { method: 'GET', path: `${REPO}/pulls/7/files`, search: '?per_page=1', body: undefined },
      {
        method: 'POST',
        path: `${REPO}/pulls/7/comments`,
        search: '',
        body: { body: 'banner', commit_id: 'abc', path: 'src/a.ts', subject_type: 'file' }
      }
    ]);
    expect(out).toEqual({ discussionId: 'gh-review-thread-404', noteId: 404, path: 'src/a.ts' });
  });

  test('a pull request with no changed files returns null and posts nothing', async () => {
    const calls = forge(routes([]));
    const out = await provider().createFileComment('o/r', 7, 'banner');
    expect(out).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  test('a files read that outlives writeTimeoutMs rejects without posting', async () => {
    const methods: string[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      methods.push(String(init?.method ?? 'GET').toUpperCase());
      if (String(input).endsWith('/pulls/7')) return Promise.resolve(jsonResponse({ number: 7, head: { sha: 'abc' } }));
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as typeof fetch;
    const err = await new GitHubProvider('https://github.com', `tok-file-comment-${++tokens}`, { writeTimeoutMs: 50 })
      .createFileComment('o/r', 7, 'banner')
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "createFileComment timed out reading the pull request's changed files; nothing was posted"
    );
    expect(methods).toEqual(['GET', 'GET']);
  });

  test('a 502 on the POST rejects with the may-have-landed error after one POST', async () => {
    const calls = forge(routes([{ filename: 'src/a.ts' }], () => jsonResponse({ message: 'Bad Gateway' }, 502)));
    const err = await provider().createFileComment('o/r', 7, 'banner').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteOutcomeUnknownError);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('GitHub fetchMRDiscussions on a file-level comment', () => {
  test('maps it to a resolvable review thread with a numeric root note and resolved from the thread index', async () => {
    forge(
      (method, path) => {
        if (method !== 'GET') return undefined;
        if (path === `${REPO}/pulls/7/comments`)
          return jsonResponse([
            {
              id: 404,
              body: 'banner',
              user: { id: 1, login: 'ada', avatar_url: 'https://x/a.png', type: 'User' },
              created_at: '2026-11-13T00:00:00Z',
              path: 'src/a.ts',
              subject_type: 'file',
              line: null,
              original_line: null,
              in_reply_to_id: undefined
            }
          ]);
        if (path.endsWith('/files') || path.endsWith('/reviews') || path === `${REPO}/issues/7/comments`)
          return jsonResponse([]);
        return undefined;
      },
      (query) =>
        query.includes('GlancePullRequestThreads')
          ? {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [{ id: 'T_1', isResolved: true, comments: { nodes: [{ databaseId: 404 }] } }]
                  }
                }
              }
            }
          : undefined
    );

    const detail = await provider().fetchMRDiscussions('github:o/r', 7);

    expect(detail.discussions).toHaveLength(1);
    const thread = detail.discussions[0]!;
    expect(thread.id).toBe('gh-review-thread-404');
    expect(thread.resolvable).toBe(true);
    expect(thread.resolved).toBe(true);
    expect(thread.notes[0]!.id).toBe(404);
    expect(typeof thread.notes[0]!.id).toBe('number');
    expect(thread.notes[0]!.resolved).toBe(true);
  });
});
