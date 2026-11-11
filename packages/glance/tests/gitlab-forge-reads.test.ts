#!/usr/bin/env bun
/**
 * GitLab side of the forge-neutral reads (labels, pipeline list, MR summaries).
 * The request shapes mirror what the rt daemon sent with raw REST before the
 * reads moved onto gitbeaker, so each test pins the path and query.
 */
import { GitbeakerRetryError } from '@gitbeaker/rest';
import { afterEach, describe, expect, test } from 'bun:test';
import { ForgeHttpError } from '../src/errors.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reply = { status?: number; statusText?: string; body: unknown; headers?: Record<string, string> };

function stubFetch(replies: Reply[]): URL[] {
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const raw = input instanceof Request ? input.url : input.toString();
    urls.push(new URL(raw));
    const reply = replies[Math.min(urls.length - 1, replies.length - 1)]!;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      statusText: reply.statusText ?? 'OK',
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as typeof fetch;
  return urls;
}

const provider = () => new GitLabProvider('https://gitlab.example.com', 'token');

function helperOf(p: GitLabProvider): (e: unknown) => never {
  return (p as unknown as { forgeHttpError(e: unknown): never }).forgeHttpError.bind(p);
}

function mrRow(iid: number) {
  return {
    iid,
    title: `MR ${iid}`,
    state: 'opened',
    draft: false,
    source_branch: `b${iid}`,
    target_branch: 'main',
    author: { username: 'ada' },
    web_url: `https://gitlab.example.com/g/p/-/merge_requests/${iid}`,
    detailed_merge_status: 'mergeable',
    merged_at: null,
  };
}

describe('capabilities', () => {
  test('GitLab advertises the three reads', () => {
    const caps = provider().capabilities;
    expect(caps.canFetchProjectLabels).toBe(true);
    expect(caps.canFetchPipelineList).toBe(true);
    expect(caps.canFetchPullRequestSummaries).toBe(true);
  });
});

describe('fetchProjectLabels', () => {
  test('requests per_page=100 with search and maps rows', async () => {
    const urls = stubFetch([{ body: [{ name: 'bug', description: 'broken', color: '#f00', id: 1 }, { name: 'x' }] }]);
    const res = await provider().fetchProjectLabels!('g/p', { search: 'b' });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.pathname).toBe('/api/v4/projects/g%2Fp/labels');
    expect(urls[0]!.searchParams.get('per_page')).toBe('100');
    expect(urls[0]!.searchParams.get('search')).toBe('b');
    expect(res).toEqual({
      labels: [
        { name: 'bug', description: 'broken', color: '#f00' },
        { name: 'x', description: null, color: null },
      ],
      truncated: false,
    });
  });

  test('stops at maxRows with truncated true when more pages exist', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }));
    const urls = stubFetch([{ body: page, headers: { 'x-next-page': '2', 'x-page': '1' } }]);
    const res = await provider().fetchProjectLabels!('g/p', { maxRows: 100 });
    expect(urls).toHaveLength(1);
    expect(res.labels).toHaveLength(100);
    expect(res.truncated).toBe(true);
  });

  test('exactly maxRows with no next page is not truncated', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }));
    stubFetch([{ body: page, headers: { 'x-next-page': '' } }, { body: [] }]);
    const res = await provider().fetchProjectLabels!('g/p', { maxRows: 100 });
    expect(res.labels).toHaveLength(100);
    expect(res.truncated).toBe(false);
  });
});

describe('absent x-next-page', () => {
  test('labels: a full page with no header fetches the next page', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }));
    const urls = stubFetch([{ body: page }, { body: [{ name: 'last' }] }]);
    const res = await provider().fetchProjectLabels!('g/p');
    expect(urls).toHaveLength(2);
    expect(urls[1]!.searchParams.get('page')).toBe('2');
    expect(res.labels).toHaveLength(101);
  });

  test('summaries: a full page with no header fetches the next page', async () => {
    const page = Array.from({ length: 100 }, (_, i) => mrRow(i + 1));
    const urls = stubFetch([{ body: page }, { body: [mrRow(101)] }]);
    const res = await provider().fetchPullRequestSummaries!('g/p', { state: 'opened', limit: 100 });
    expect(urls).toHaveLength(2);
    expect(res.rows).toHaveLength(100);
    expect(res.truncated).toBe(true);
  });

  test('an empty page with a next header stops', async () => {
    const urls = stubFetch([{ body: [], headers: { 'x-next-page': '2' } }]);
    const summaries = await provider().fetchPullRequestSummaries!('g/p', { state: 'opened', limit: 5 });
    const labels = await provider().fetchProjectLabels!('g/p');
    expect(urls).toHaveLength(2);
    expect(summaries).toEqual({ rows: [], truncated: false });
    expect(labels).toEqual({ labels: [], truncated: false });
  });
});

describe('fetchPipelineList', () => {
  test('lists project pipelines newest first by ref and sha, one page of limit rows', async () => {
    const urls = stubFetch([
      {
        body: [
          { id: 9, status: 'success', ref: 'main', sha: 'abc', source: 'push', web_url: 'u', created_at: 't' },
          { id: 8, status: 'failed' },
        ],
      },
    ]);
    const rows = await provider().fetchPipelineList!('g/p', { ref: 'main', sha: 'abc', limit: 2 });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.pathname).toBe('/api/v4/projects/g%2Fp/pipelines');
    expect(urls[0]!.searchParams.get('order_by')).toBe('id');
    expect(urls[0]!.searchParams.get('sort')).toBe('desc');
    expect(urls[0]!.searchParams.get('ref')).toBe('main');
    expect(urls[0]!.searchParams.get('sha')).toBe('abc');
    expect(urls[0]!.searchParams.get('per_page')).toBe('2');
    expect(rows).toEqual([
      { id: 9, status: 'success', ref: 'main', sha: 'abc', source: 'push', webUrl: 'u', createdAt: 't' },
      { id: 8, status: 'failed', ref: null, sha: null, source: null, webUrl: null, createdAt: null },
    ]);
  });

  test('does not follow next pages past limit', async () => {
    const urls = stubFetch([
      {
        body: [{ id: 1, status: 'success' }],
        headers: {
          'x-next-page': '2',
          link: '<https://gitlab.example.com/api/v4/projects/g%2Fp/pipelines?page=2>; rel="next"',
        },
      },
    ]);
    await provider().fetchPipelineList!('g/p', { limit: 1 });
    expect(urls).toHaveLength(1);
  });

  test('with iid lists the MR own pipelines without order or filters', async () => {
    const urls = stubFetch([{ body: [{ id: 3, status: 'running' }] }]);
    await provider().fetchPipelineList!('g/p', { iid: 7, limit: 20 });
    expect(urls[0]!.pathname).toBe('/api/v4/projects/g%2Fp/merge_requests/7/pipelines');
    expect(urls[0]!.searchParams.get('per_page')).toBe('20');
    expect(urls[0]!.searchParams.has('order_by')).toBe(false);
    expect(urls[0]!.searchParams.has('sort')).toBe(false);
  });
});

describe('fetchPullRequestSummaries', () => {
  test('sends filters, order and maps rows', async () => {
    const urls = stubFetch([{ body: [mrRow(1)] }]);
    const res = await provider().fetchPullRequestSummaries!('g/p', {
      state: 'opened',
      author: 'ada',
      sourceBranch: 'b1',
      targetBranch: 'main',
      search: 'fix',
      limit: 5,
      sort: 'updated_desc',
    });
    const q = urls[0]!.searchParams;
    expect(urls[0]!.pathname).toBe('/api/v4/projects/g%2Fp/merge_requests');
    expect(q.get('state')).toBe('opened');
    expect(q.get('order_by')).toBe('updated_at');
    expect(q.get('sort')).toBe('desc');
    expect(q.get('scope')).toBe('all');
    expect(q.get('author_username')).toBe('ada');
    expect(q.get('source_branch')).toBe('b1');
    expect(q.get('target_branch')).toBe('main');
    expect(q.get('search')).toBe('fix');
    expect(q.get('per_page')).toBe('100');
    expect(res).toEqual({
      rows: [
        {
          iid: 1,
          title: 'MR 1',
          state: 'opened',
          draft: false,
          sourceBranch: 'b1',
          targetBranch: 'main',
          author: 'ada',
          webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
          detailedMergeStatus: 'mergeable',
          mergedAt: null,
        },
      ],
      truncated: false,
    });
  });

  test('without sort sends neither order_by nor sort; author me is created_by_me', async () => {
    const urls = stubFetch([{ body: [] }]);
    await provider().fetchPullRequestSummaries!('g/p', { state: 'all', author: 'me', limit: 5 });
    const q = urls[0]!.searchParams;
    expect(q.has('order_by')).toBe(false);
    expect(q.has('sort')).toBe(false);
    expect(q.get('scope')).toBe('created_by_me');
    expect(q.has('author_username')).toBe(false);
    expect(q.get('state')).toBe('all');
  });

  test('no author sends scope=all', async () => {
    const urls = stubFetch([{ body: [] }]);
    await provider().fetchPullRequestSummaries!('g/p', { state: 'opened', limit: 5 });
    expect(urls[0]!.searchParams.get('scope')).toBe('all');
    expect(urls[0]!.searchParams.has('author_username')).toBe(false);
  });

  test('101 rows with limit 100 returns 100 and truncated', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => mrRow(i + 1));
    const urls = stubFetch([
      { body: page1, headers: { 'x-next-page': '2' } },
      { body: [mrRow(101)], headers: { 'x-next-page': '' } },
    ]);
    const res = await provider().fetchPullRequestSummaries!('g/p', { state: 'opened', limit: 100 });
    expect(urls).toHaveLength(2);
    expect(urls[1]!.searchParams.get('page')).toBe('2');
    expect(res.rows).toHaveLength(100);
    expect(res.truncated).toBe(true);
  });

  test('a short last page stops the walk', async () => {
    const urls = stubFetch([{ body: [mrRow(1), mrRow(2)], headers: { 'x-next-page': '' } }]);
    const res = await provider().fetchPullRequestSummaries!('g/p', { state: 'opened', limit: 100 });
    expect(urls).toHaveLength(1);
    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(false);
  });

  test('a short page with no x-next-page header stops the walk', async () => {
    const urls = stubFetch([{ body: [mrRow(1), mrRow(2)] }]);
    const res = await provider().fetchPullRequestSummaries!('g/p', { state: 'opened', limit: 100 });
    expect(urls).toHaveLength(1);
    expect(res.truncated).toBe(false);
  });
});

describe('error mapping', () => {
  test('a 404 becomes ForgeHttpError with the parsed GitLab message as bodyText', async () => {
    stubFetch([{ status: 404, statusText: 'Not Found', body: { message: '404 Project Not Found' } }]);
    const err = await provider()
      .fetchProjectLabels!('g/missing')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    const http = err as ForgeHttpError;
    expect(http.status).toBe(404);
    expect(http.statusText).toBe('Not Found');
    expect(http.bodyText).toBe('404 Project Not Found');
    expect(http.message).toBe('GitLab returned 404 Not Found: 404 Project Not Found');
  });

  test('the pipeline and summary reads map a 404 too', async () => {
    stubFetch([{ status: 404, statusText: 'Not Found', body: { message: '404 Project Not Found' } }]);
    const p = provider();
    for (const call of [
      () => p.fetchPipelineList!('g/x', { limit: 1 }),
      () => p.fetchPipelineList!('g/x', { iid: 1, limit: 1 }),
      () => p.fetchPullRequestSummaries!('g/x', { state: 'opened', limit: 1 }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ForgeHttpError);
    }
  });

  test('a GitbeakerRetryError becomes ForgeHttpError with the last status', () => {
    const retry = new GitbeakerRetryError(
      'Could not successfully complete this request after 10 retries, last status code: 429. Check the applicable rate limits for this endpoint.',
    );
    let thrown: unknown;
    try {
      helperOf(provider())(retry);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForgeHttpError);
    expect((thrown as ForgeHttpError).status).toBe(429);
  });

  test('anything else is rethrown unchanged', () => {
    const boom = new TypeError('boom');
    expect(() => helperOf(provider())(boom)).toThrow(boom);
  });
});
