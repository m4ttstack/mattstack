/**
 * Waiting out a GitLab 429.
 *
 * GitLab.com caps a Free-plan user at 100 requests a minute
 * (`ratelimit-name: burst_traffic_per_user_free_plan`) and refuses every
 * request past that until the minute rolls over. A 429 means the request was
 * not applied, so retrying it after the reset is safe for a write too. Every
 * GitLab transport in glance runs its request through `withGitLabRateLimit`.
 */
import { RateLimitedError } from './errors.ts';

/**
 * The longest a read waits before throwing, the same as GitHub's
 * `RATE_LIMIT_RETRY_DEADLINE_S`: past it, the wait is the daemon's to
 * schedule, not a sync cycle's to sit through.
 */
export const GITLAB_READ_RATE_LIMIT_DEADLINE_S = 30;

/**
 * One full GitLab window plus a margin, so a write the user asked for (an
 * inline comment, a merge) always lands after the reset instead of failing.
 */
export const GITLAB_WRITE_RATE_LIMIT_DEADLINE_S = 65;

/** `retry-after` is whole seconds, so the reset can land up to a second late. */
export const RATE_LIMIT_RESET_MARGIN_MS = 500;

/** A 429 seen by a transport, carrying the headers that name the reset. Never leaves `withGitLabRateLimit`. */
export class GitLabRateLimitHit extends Error {
  override readonly name = 'GitLabRateLimitHit';
  constructor(readonly headers: Headers) {
    super('GitLab answered 429 Too Many Requests');
  }
}

export function throwIfGitLabRateLimited(res: Response): void {
  if (res.status !== 429) return;
  res.body?.cancel().catch(() => {});
  throw new GitLabRateLimitHit(res.headers);
}

/** Milliseconds until the reset, `retry-after` first since it is relative and so immune to clock skew. */
function untilReset(headers: Headers, nowMs: number): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null && retryAfter.trim() !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.max(0, at - nowMs);
  }
  const reset = Number(headers.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - nowMs);
  return null;
}

/** How long to wait before retrying, margin included; null when the reply names no reset. */
export function gitlabRateLimitWaitMs(headers: Headers, nowMs: number): number | null {
  const ms = untilReset(headers, nowMs);
  return ms === null ? null : ms + RATE_LIMIT_RESET_MARGIN_MS;
}

export interface GitLabRateLimitOptions {
  /** Caller cancellation; aborts a wait in progress. */
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/**
 * Run `send`, and while it throws `GitLabRateLimitHit`, wait for the reset
 * and run it again. Once the total wait would pass the deadline for `kind`,
 * throw `RateLimitedError` instead. Anything else `send` throws passes
 * through on the first throw.
 *
 * The deadline bounds one request. An operation that sends several (a
 * paginated read, a fan-out) can wait up to the deadline on each, though
 * after one reset its later requests rarely meet another 429 in the same
 * minute.
 */
export async function withGitLabRateLimit<T>(
  operation: string,
  kind: 'read' | 'write',
  send: () => Promise<T>,
  opts: GitLabRateLimitOptions = {},
): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? abortableSleep;
  const deadlineMs = (kind === 'read' ? GITLAB_READ_RATE_LIMIT_DEADLINE_S : GITLAB_WRITE_RATE_LIMIT_DEADLINE_S) * 1000;
  let waitedMs = 0;
  for (;;) {
    try {
      return await send();
    } catch (err) {
      if (!(err instanceof GitLabRateLimitHit)) throw err;
      const at = now();
      const waitMs = gitlabRateLimitWaitMs(err.headers, at);
      if (waitMs === null || waitedMs + waitMs > deadlineMs) throw rateLimitedError(operation, err.headers, at, waitMs);
      await sleep(waitMs, opts.signal);
      waitedMs += waitMs;
    }
  }
}

function rateLimitedError(operation: string, headers: Headers, nowMs: number, waitMs: number | null): RateLimitedError {
  const untilMs = untilReset(headers, nowMs);
  const reset = untilMs === null ? null : new Date(nowMs + untilMs);
  const resetAt = reset === null || Number.isNaN(reset.getTime()) ? null : reset.toISOString();
  const hint = waitMs === null ? '' : `; retry after ${Math.ceil(waitMs / 1000)} seconds`;
  return new RateLimitedError(`GitLab rate limit hit on ${operation}${hint}`, {
    kind: 'secondary',
    resetAt,
    retryAfterMs: waitMs,
    operation,
  });
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
