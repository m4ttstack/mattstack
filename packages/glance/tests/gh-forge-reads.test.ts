import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { ForgeHttpError, RateLimitedError } from '../src/errors.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let providers = 0;
function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-forge-reads-${++providers}`);
}

function run(over: Record<string, unknown> = {}) {
  return {
    id: 77,
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request',
    head_branch: 'feature',
    head_sha: 'abc123',
    html_url: 'https://github.com/o/r/actions/runs/77',
    created_at: '2026-01-02T00:00:00Z',
    ...over
  };
}

function job(id: number, conclusion: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    run_id: 77,
    name: `job-${id}`,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    started_at: '2026-01-02T00:00:00Z',
    completed_at: '2026-01-02T00:01:30Z',
    html_url: `https://github.com/o/r/actions/runs/77/job/${id}`,
    ...over
  };
}

const rateLimited = () =>
  jsonResponse({ message: 'API rate limit exceeded' }, 403, {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600)
  });

describe('fetchProjectLabels', () => {
  const labels = [
    { name: 'Bug', description: 'Broken', color: 'd73a4a' },
    { name: 'docs', description: null, color: '0075ca' },
    { name: 'debug-tools', description: '', color: 'ffffff' }
  ];

  test('maps name, description and a # color', async () => {
    stubForge({ rest: (url) => (url.includes('/repos/o/r/labels') ? jsonResponse(labels) : undefined) });
    const out = await provider().fetchProjectLabels!('o/r');
    expect(out.truncated).toBe(false);
    expect(out.labels[0]).toEqual({ name: 'Bug', description: 'Broken', color: '#d73a4a' });
    expect(out.labels[1]).toEqual({ name: 'docs', description: null, color: '#0075ca' });
  });

  test('search filters by case-insensitive substring', async () => {
    stubForge({ rest: () => jsonResponse(labels) });
    const out = await provider().fetchProjectLabels!('o/r', { search: 'BUG' });
    expect(out.labels.map((l) => l.name)).toEqual(['Bug', 'debug-tools']);
  });

  test('maxRows cuts the list and marks it truncated', async () => {
    stubForge({ rest: () => jsonResponse(labels) });
    const out = await provider().fetchProjectLabels!('o/r', { maxRows: 2 });
    expect(out.labels).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });

  test('a rate limit rejects with RateLimitedError', async () => {
    stubForge({ rest: rateLimited });
    expect(await provider().fetchProjectLabels!('o/r').catch((e: unknown) => e)).toBeInstanceOf(
      RateLimitedError
    );
  });

  test('a 404 rejects with ForgeHttpError', async () => {
    stubForge({});
    const err = await provider().fetchProjectLabels!('o/r').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
    expect((err as ForgeHttpError).message).toBe('GitHub returned 404 Not Found: Not Found');
  });

  test("bodyText is GitHub's message, not the JSON body", async () => {
    stubForge({});
    const err = (await provider().fetchProjectLabels!('o/r').catch((e: unknown) => e)) as ForgeHttpError;
    expect(err.bodyText).toBe('Not Found');
  });

  test('bodyText is the raw body when it carries no message', async () => {
    stubForge({
      rest: () => new Response('upstream broke', { status: 400, headers: { 'content-type': 'text/plain' } })
    });
    const err = (await provider().fetchProjectLabels!('o/r').catch((e: unknown) => e)) as ForgeHttpError;
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect(err.bodyText).toBe('upstream broke');
    expect(err.message).toBe('GitHub returned 400 Bad Request: upstream broke');
  });
});

describe('fetchPipelineList', () => {
  test('maps a run to a list entry', async () => {
    const { urls } = stubForge({
      rest: () =>
        jsonResponse({
          workflow_runs: [
            run(),
            run({ id: 78, status: 'in_progress', conclusion: null }),
            run({ id: 79, conclusion: 'cancelled' }),
            run({ id: 80, conclusion: 'failure', event: 'push' })
          ]
        })
    });
    const rows = await provider().fetchPipelineList!('o/r', { ref: 'feature', sha: 'abc123', limit: 5 });
    expect(rows[0]).toEqual({
      id: 77,
      status: 'success',
      ref: 'feature',
      sha: 'abc123',
      source: 'pull_request',
      webUrl: 'https://github.com/o/r/actions/runs/77',
      createdAt: '2026-01-02T00:00:00Z'
    });
    expect(rows.map((r) => r.status)).toEqual(['success', 'running', 'canceled', 'failed']);
    expect(rows[3]!.source).toBe('push');
    expect(urls).toHaveLength(1);
    const q = new URL(urls[0]!).searchParams;
    expect(q.get('branch')).toBe('feature');
    expect(q.get('head_sha')).toBe('abc123');
    expect(q.get('per_page')).toBe('5');
  });

  test('without iid it makes 1 request', async () => {
    const { urls } = stubForge({ rest: () => jsonResponse({ workflow_runs: [] }) });
    await provider().fetchPipelineList!('o/r', { limit: 10 });
    expect(urls).toHaveLength(1);
  });

  test('with iid it reads the PR head sha first, then lists by it: 2 requests', async () => {
    const { urls } = stubForge({
      rest: (url) =>
        url.includes('/pulls/9')
          ? jsonResponse({ head: { sha: 'def456' } })
          : jsonResponse({ workflow_runs: [run({ head_sha: 'def456' })] })
    });
    const rows = await provider().fetchPipelineList!('o/r', { iid: 9, limit: 10 });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/repos/o/r/pulls/9');
    expect(new URL(urls[1]!).searchParams.get('head_sha')).toBe('def456');
    expect(rows).toHaveLength(1);
  });

  test('a rate limit rejects with RateLimitedError', async () => {
    stubForge({ rest: rateLimited });
    expect(await provider().fetchPipelineList!('o/r', { limit: 3 }).catch((e: unknown) => e)).toBeInstanceOf(
      RateLimitedError
    );
  });

  test('a 404 rejects with ForgeHttpError', async () => {
    stubForge({});
    const err = await provider().fetchPipelineList!('o/r', { limit: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
  });
});

describe('fetchCommitParents', () => {
  test('returns the parent shas', async () => {
    const { urls } = stubForge({
      rest: () => jsonResponse({ sha: 'c', parents: [{ sha: 'p1' }, { sha: 'p2' }] })
    });
    expect(await provider().fetchCommitParents!('o/r', 'c')).toEqual(['p1', 'p2']);
    expect(urls[0]).toContain('/repos/o/r/commits/c');
  });

  test('a rate limit rejects with RateLimitedError', async () => {
    stubForge({ rest: rateLimited });
    expect(await provider().fetchCommitParents!('o/r', 'c').catch((e: unknown) => e)).toBeInstanceOf(
      RateLimitedError
    );
  });

  test('a 404 rejects with ForgeHttpError', async () => {
    stubForge({});
    const err = await provider().fetchCommitParents!('o/r', 'c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
  });
});

describe('fetchPipelineFailedJobs', () => {
  test('keeps failure, timed_out and cancelled jobs in the check-run id format', async () => {
    const { urls } = stubForge({
      rest: () =>
        jsonResponse({
          total_count: 5,
          jobs: [
            job(1, 'success'),
            job(2, 'failure'),
            job(3, 'timed_out'),
            job(4, 'cancelled'),
            job(5, null)
          ]
        })
    });
    const jobs = await provider().fetchPipelineFailedJobs!('o/r', 77);
    expect(jobs.map((j) => j.id)).toEqual(['github:check:2', 'github:check:3', 'github:check:4']);
    expect(jobs.map((j) => j.status)).toEqual(['failed', 'failed', 'canceled']);
    expect(jobs[0]).toEqual({
      id: 'github:check:2',
      name: 'job-2',
      stage: 'checks',
      status: 'failed',
      allowFailure: false,
      duration: 90,
      webUrl: 'https://github.com/o/r/actions/runs/77/job/2',
      runId: '77'
    });
    expect(urls[0]).toContain('/repos/o/r/actions/runs/77/jobs');
    expect(new URL(urls[0]!).searchParams.get('filter')).toBe('latest');
  });

  test('a run with more jobs than the page cap throws instead of returning a partial list', async () => {
    const { urls } = stubForge({
      rest: (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        return jsonResponse({
          total_count: 2100,
          jobs: Array.from({ length: 100 }, (_, i) => job(page * 1000 + i, 'failure'))
        });
      }
    });
    const err = await provider().fetchPipelineFailedJobs!('o/r', 77).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ForgeHttpError);
    expect((err as Error).message).toBe(
      'fetchPipelineFailedJobs failed: workflow run 77 has more than 2000 jobs, past the 20-page read cap'
    );
    expect(urls).toHaveLength(20);
  });

  test('a short 20th page ends the walk without an error', async () => {
    const { urls } = stubForge({
      rest: (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        const size = page < 20 ? 100 : 5;
        return jsonResponse({
          total_count: 1905,
          jobs: Array.from({ length: size }, (_, i) => job(page * 1000 + i, page === 20 ? 'failure' : 'success'))
        });
      }
    });
    expect(await provider().fetchPipelineFailedJobs!('o/r', 77)).toHaveLength(5);
    expect(urls).toHaveLength(20);
  });

  test('a rate limit rejects with RateLimitedError', async () => {
    stubForge({ rest: rateLimited });
    expect(await provider().fetchPipelineFailedJobs!('o/r', 77).catch((e: unknown) => e)).toBeInstanceOf(
      RateLimitedError
    );
  });

  test('a 404 rejects with ForgeHttpError', async () => {
    stubForge({});
    const err = await provider().fetchPipelineFailedJobs!('o/r', 77).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeHttpError);
    expect((err as ForgeHttpError).status).toBe(404);
  });
});
