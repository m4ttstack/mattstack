#!/usr/bin/env bun
/**
 * Unit coverage for GitHub's CI-retry path: `fetchJobTrace`, `retryJob`, and
 * `retryPipeline`.
 *
 * Before this file, none of the three had any unit coverage. In particular,
 * nothing pinned `fetchJobTrace`'s handling of Octokit's `data` shape, which
 * varies with the redirect target's content type (a string, an ArrayBuffer,
 * or a JSON object), nor the exact `statusText`-shaped error message
 * `retryJob` and `retryPipeline` throw on failure. `(provider as
 * any).octokit` is stubbed directly rather than going through the real
 * transport, since these methods call `octokit.request` and none of the
 * three needs a live fetch to prove its own logic.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

function stubOctokitRequest(
  handler: (route: string) => { data: unknown } | Promise<{ data: unknown }>
) {
  return async (route: string) => handler(route);
}

function stubOctokitThrows(err: unknown) {
  return async () => {
    throw err;
  };
}

function fakeRequestError(status: number, data: unknown): RequestError {
  return new RequestError('failed', status, {
    request: { method: 'POST', url: 'https://api.github.com/x', headers: {} },
    response: { status, url: '', headers: {}, data }
  });
}

describe('fetchJobTrace', () => {
  test('an ArrayBuffer body decodes to its text', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({
        data: new TextEncoder().encode('fail-marker present\n').buffer
      }))
    };

    const trace = await provider.fetchJobTrace('acme/repo', 1);
    expect(trace).toBe('fail-marker present\n');
  });

  test('a string body passes through untouched', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({ data: 'plain log text' }))
    };

    const trace = await provider.fetchJobTrace('acme/repo', 1);
    expect(trace).toBe('plain log text');
  });

  test('a JSON object body returns a string instead of throwing', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({ data: { message: 'unexpected' } }))
    };

    const trace = await provider.fetchJobTrace('acme/repo', 1);
    expect(typeof trace).toBe('string');
    expect(trace).toBe('{"message":"unexpected"}');
  });

  test('a 403 surfaces the statusText-shaped message', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(fakeRequestError(403, { message: 'Forbidden' }))
    };

    const err = await provider.fetchJobTrace('acme/repo', 1).catch((e) => e as Error);
    expect(err.message).toBe(
      'fetchJobTrace failed: 403 Forbidden — {"message":"Forbidden"}'
    );
  });
});

describe('retryPipeline', () => {
  describe('reruns every failed run on the head commit', () => {
    interface WorkflowRun {
      id: number;
      status: string;
      conclusion: string | null;
    }

    /** Run 100 sits on sha `abc`; `runs` is what the commit's run list returns. */
    function commit(runs: WorkflowRun[], refuse: Record<number, number> = {}) {
      const calls: string[] = [];
      stubForge({
        rest: (url, method) => {
          const u = new URL(url);
          calls.push(`${method} ${u.pathname}${u.search}`);
          if (method === 'GET' && u.pathname === '/repos/o/r/actions/runs/100') {
            return jsonResponse({ id: 100, head_sha: 'abc' });
          }
          if (method === 'GET' && u.pathname === '/repos/o/r/actions/runs') {
            return jsonResponse({ total_count: runs.length, workflow_runs: runs });
          }
          if (method === 'POST') {
            const runId = Number(u.pathname.split('/')[6]);
            const refused = refuse[runId];
            return refused
              ? jsonResponse({ message: 'Forbidden' }, refused)
              : jsonResponse({}, 201);
          }
          return undefined;
        }
      });
      return calls;
    }

    const done = (id: number, conclusion: string): WorkflowRun => ({
      id,
      status: 'completed',
      conclusion
    });

    test('reruns the failed and timed-out runs and nothing else', async () => {
      const calls = commit([
        done(100, 'success'),
        done(101, 'failure'),
        done(102, 'timed_out'),
        { id: 103, status: 'in_progress', conclusion: null }
      ]);

      await new GitHubProvider('https://github.com', 'tok-retry-1').retryPipeline('o/r', 100);

      expect(calls).toEqual([
        'GET /repos/o/r/actions/runs/100',
        'GET /repos/o/r/actions/runs?head_sha=abc&per_page=100',
        'POST /repos/o/r/actions/runs/101/rerun-failed-jobs',
        'POST /repos/o/r/actions/runs/102/rerun-failed-jobs'
      ]);
    });

    test('reruns the named run when it is the one that failed', async () => {
      const calls = commit([done(100, 'failure'), done(101, 'success')]);

      await new GitHubProvider('https://github.com', 'tok-retry-2').retryPipeline('o/r', 100);

      expect(calls.filter(c => c.startsWith('POST '))).toEqual([
        'POST /repos/o/r/actions/runs/100/rerun-failed-jobs'
      ]);
    });

    test('reruns a cancelled run when the rest are green', async () => {
      const calls = commit([done(100, 'success'), done(101, 'cancelled'), done(102, 'skipped')]);

      await new GitHubProvider('https://github.com', 'tok-retry-5').retryPipeline('o/r', 100);

      expect(calls.filter(c => c.startsWith('POST '))).toEqual([
        'POST /repos/o/r/actions/runs/101/rerun-failed-jobs'
      ]);
    });

    test('reruns stale and startup_failure runs', async () => {
      const calls = commit([
        done(100, 'success'),
        done(101, 'stale'),
        done(102, 'startup_failure')
      ]);

      await new GitHubProvider('https://github.com', 'tok-retry-6').retryPipeline('o/r', 100);

      expect(calls.filter(c => c.startsWith('POST '))).toEqual([
        'POST /repos/o/r/actions/runs/101/rerun-failed-jobs',
        'POST /repos/o/r/actions/runs/102/rerun-failed-jobs'
      ]);
    });

    test('sends every rerun and names both groups when one is refused', async () => {
      const calls = commit(
        [done(100, 'failure'), done(101, 'failure'), done(102, 'cancelled')],
        { 101: 403 }
      );

      const err = await new GitHubProvider('https://github.com', 'tok-retry-7')
        .retryPipeline('o/r', 100)
        .then(
          () => null,
          (e: unknown) => e as Error
        );

      expect(calls.filter(c => c.startsWith('POST '))).toEqual([
        'POST /repos/o/r/actions/runs/100/rerun-failed-jobs',
        'POST /repos/o/r/actions/runs/101/rerun-failed-jobs',
        'POST /repos/o/r/actions/runs/102/rerun-failed-jobs'
      ]);
      expect(err?.message).toContain('retryPipeline failed');
      expect(err?.message).toContain('reran 100, 102');
      expect(err?.message).toContain('refused 101 (403 Forbidden');
    });

    test('names the project, the run and the sha when nothing failed', async () => {
      const calls = commit([
        done(100, 'success'),
        done(101, 'skipped'),
        { id: 102, status: 'in_progress', conclusion: null }
      ]);

      const err = await new GitHubProvider('https://github.com', 'tok-retry-3')
        .retryPipeline('o/r', 100)
        .then(
          () => null,
          (e: unknown) => e as Error
        );

      expect(err?.message).toContain('o/r');
      expect(err?.message).toContain('100');
      expect(err?.message).toContain('abc');
      expect(err?.message).toContain('no failed or cancelled runs');
      expect(calls.filter(c => c.startsWith('POST '))).toEqual([]);
    });

    test('a missing run keeps the external-CI note', async () => {
      stubForge({});

      const err = await new GitHubProvider('https://github.com', 'tok-retry-4')
        .retryPipeline('o/r', 100)
        .then(
          () => null,
          (e: unknown) => e as Error
        );

      expect(err?.message).toBe(
        'retryPipeline failed: 404 Not Found — {"message":"Not Found"} (only a GitHub Actions run can be retried; a commit status from external CI has no retry)'
      );
    });
  });

  test('a 404 says only an Actions run can be retried', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(fakeRequestError(404, { message: 'Not Found' }))
    };

    const err = await provider.retryPipeline('acme/repo', 1).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err?.message).toBe(
      'retryPipeline failed: 404 Not Found — {"message":"Not Found"} (only a GitHub Actions run can be retried; a commit status from external CI has no retry)'
    );
  });

  test('a 403 surfaces the statusText-shaped message', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(fakeRequestError(403, { message: 'Forbidden' }))
    };

    const err = await provider.retryPipeline('acme/repo', 1).catch((e) => e as Error);
    expect(err.message).toBe(
      'retryPipeline failed: 403 Forbidden — {"message":"Forbidden"}'
    );
  });
});

describe('retryJob', () => {
  test('a successful retry resolves with no error', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({ data: {} }))
    };

    await expect(provider.retryJob('acme/repo', 1)).resolves.toBeUndefined();
  });

  test('a 403 pins the exact message quoted as evidence in two specs documents', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(
        fakeRequestError(403, {
          message: 'The workflow run containing this job is already running',
          documentation_url:
            'https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run',
          status: '403'
        })
      )
    };

    const err = await provider.retryJob('acme/repo', 1).catch((e) => e as Error);
    expect(err.message).toBe(
      'retryJob failed: 403 Forbidden — {"message":"The workflow run containing this job is already running","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run","status":"403"}'
    );
  });
});
