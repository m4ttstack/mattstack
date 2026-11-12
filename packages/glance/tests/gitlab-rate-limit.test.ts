/**
 * GitLab's 429 policy: wait for the reset the reply names, plus a margin, up
 * to a deadline (30s for a read, 65s for a write), then throw
 * `RateLimitedError`. Header names are the ones GitLab.com sends to a
 * Free-plan user past 100 requests a minute.
 */
import { describe, expect, test } from 'bun:test';
import { RateLimitedError } from '../src/errors.ts';
import {
  GITLAB_READ_RATE_LIMIT_DEADLINE_S,
  GITLAB_WRITE_RATE_LIMIT_DEADLINE_S,
  GitLabRateLimitHit,
  RATE_LIMIT_RESET_MARGIN_MS,
  gitlabRateLimitWaitMs,
  throwIfGitLabRateLimited,
  withGitLabRateLimit,
} from '../src/gitlabRateLimit.ts';

const NOW = Date.parse('2026-11-12T16:05:20Z');

function limited(headers: Record<string, string>): Response {
  return new Response('{"message":"429 Too Many Requests"}', {
    status: 429,
    headers: { 'ratelimit-name': 'burst_traffic_per_user_free_plan', 'ratelimit-limit': '100', ...headers },
  });
}

/** A fake clock: `sleep` advances it instead of waiting, and records each wait. */
function fakeClock() {
  let now = NOW;
  const waits: number[] = [];
  return {
    waits,
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
  };
}

describe('gitlabRateLimitWaitMs', () => {
  test('retry-after seconds plus the margin', () => {
    expect(gitlabRateLimitWaitMs(limited({ 'retry-after': '40' }).headers, NOW)).toBe(40_000 + RATE_LIMIT_RESET_MARGIN_MS);
  });

  test('ratelimit-reset epoch seconds when there is no retry-after', () => {
    const reset = String(Math.floor(Date.parse('2026-11-12T16:06:00Z') / 1000));
    expect(gitlabRateLimitWaitMs(limited({ 'ratelimit-reset': reset }).headers, NOW)).toBe(40_000 + RATE_LIMIT_RESET_MARGIN_MS);
  });

  test('retry-after wins over ratelimit-reset, since it carries no clock skew', () => {
    const reset = String(Math.floor(Date.parse('2026-11-12T16:07:00Z') / 1000));
    const headers = limited({ 'retry-after': '40', 'ratelimit-reset': reset }).headers;
    expect(gitlabRateLimitWaitMs(headers, NOW)).toBe(40_000 + RATE_LIMIT_RESET_MARGIN_MS);
  });

  test('a reset already past waits only the margin', () => {
    const reset = String(Math.floor(Date.parse('2026-11-12T16:05:00Z') / 1000));
    expect(gitlabRateLimitWaitMs(limited({ 'ratelimit-reset': reset }).headers, NOW)).toBe(RATE_LIMIT_RESET_MARGIN_MS);
  });

  test('no usable header is null', () => {
    expect(gitlabRateLimitWaitMs(limited({}).headers, NOW)).toBeNull();
    expect(gitlabRateLimitWaitMs(limited({ 'retry-after': 'soon' }).headers, NOW)).toBeNull();
  });
});

describe('throwIfGitLabRateLimited', () => {
  test('a 429 throws GitLabRateLimitHit carrying the headers', () => {
    let thrown: unknown;
    try {
      throwIfGitLabRateLimited(limited({ 'retry-after': '3' }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GitLabRateLimitHit);
    expect((thrown as GitLabRateLimitHit).headers.get('retry-after')).toBe('3');
  });

  test('any other status passes', () => {
    for (const status of [200, 404, 500, 502]) {
      expect(() => throwIfGitLabRateLimited(new Response(null, { status }))).not.toThrow();
    }
  });
});

describe('withGitLabRateLimit', () => {
  test('the deadlines are 30s for a read and 65s for a write', () => {
    expect(GITLAB_READ_RATE_LIMIT_DEADLINE_S).toBe(30);
    expect(GITLAB_WRITE_RATE_LIMIT_DEADLINE_S).toBe(65);
  });

  test('waits the named time, then retries and returns the success', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withGitLabRateLimit(
      'GET /projects/1',
      'read',
      async () => {
        calls += 1;
        if (calls === 1) throwIfGitLabRateLimited(limited({ 'retry-after': '20' }));
        return 'ok';
      },
      clock,
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(clock.waits).toEqual([20_000 + RATE_LIMIT_RESET_MARGIN_MS]);
  });

  test('a read whose wait passes 30s throws RateLimitedError without sending again', async () => {
    const clock = fakeClock();
    let calls = 0;
    const err = await withGitLabRateLimit(
      'GET /projects/1',
      'read',
      async () => {
        calls += 1;
        throwIfGitLabRateLimited(limited({ 'retry-after': '40' }));
      },
      clock,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    const limit = err as RateLimitedError;
    expect(limit.retryAfterMs).toBe(40_000 + RATE_LIMIT_RESET_MARGIN_MS);
    expect(limit.operation).toBe('GET /projects/1');
    expect(limit.resetAt).toBe(new Date(NOW + 40_000).toISOString());
    expect(limit.message).toBe('GitLab rate limit hit on GET /projects/1; retry after 41 seconds');
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  test('a write waits out a 40s reset, since its deadline is 65s', async () => {
    const clock = fakeClock();
    let calls = 0;
    await withGitLabRateLimit(
      'POST /projects/1/merge_requests/7/discussions',
      'write',
      async () => {
        calls += 1;
        if (calls === 1) throwIfGitLabRateLimited(limited({ 'retry-after': '40' }));
      },
      clock,
    );
    expect(calls).toBe(2);
    expect(clock.waits).toEqual([40_000 + RATE_LIMIT_RESET_MARGIN_MS]);
  });

  test('the deadline counts every wait, not just the latest', async () => {
    const clock = fakeClock();
    let calls = 0;
    const err = await withGitLabRateLimit(
      'GET /projects/1',
      'read',
      async () => {
        calls += 1;
        throwIfGitLabRateLimited(limited({ 'retry-after': '20' }));
      },
      clock,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(calls).toBe(2);
    expect(clock.waits).toEqual([20_000 + RATE_LIMIT_RESET_MARGIN_MS]);
  });

  test('a 429 with no reset header throws at once with retryAfterMs null', async () => {
    const clock = fakeClock();
    const err = await withGitLabRateLimit(
      'GET /projects/1',
      'read',
      async () => throwIfGitLabRateLimited(limited({})),
      clock,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBeNull();
    expect((err as RateLimitedError).message).toBe('GitLab rate limit hit on GET /projects/1');
    expect(clock.waits).toEqual([]);
  });

  test('a reset too far off to be a date still throws RateLimitedError, with resetAt null', async () => {
    const err = await withGitLabRateLimit(
      'GET /projects/1',
      'read',
      async () => throwIfGitLabRateLimited(limited({ 'retry-after': '1e13' })),
      fakeClock(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetAt).toBeNull();
  });

  test('any other error passes through untouched, unretried', async () => {
    const boom = new Error('500 Internal Server Error');
    let calls = 0;
    const err = await withGitLabRateLimit(
      'POST /x',
      'write',
      async () => {
        calls += 1;
        throw boom;
      },
      fakeClock(),
    ).catch((e: unknown) => e);
    expect(err).toBe(boom);
    expect(calls).toBe(1);
  });

  test('caller cancellation during the wait rejects without another send', async () => {
    const caller = new AbortController();
    let calls = 0;
    const pending = withGitLabRateLimit(
      'GET /projects/1',
      'read',
      async () => {
        calls += 1;
        throwIfGitLabRateLimited(limited({ 'retry-after': '20' }));
      },
      { signal: caller.signal },
    );
    setTimeout(() => caller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });
});
