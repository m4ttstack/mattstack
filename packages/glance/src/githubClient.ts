/**
 * Octokit construction and error translation for GitHubProvider.
 *
 * The provider used a bare fetch before this, which meant no retry, no
 * throttling, pagination that silently truncated on a failed page, and no
 * request instrumentation at all on the GitHub side.
 */
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { RequestError } from '@octokit/request-error';
import { safeEmit, type OnRequestHook } from './instrumentation.ts';
import type { ForgeLogger } from './logger.ts';
import { RateLimitedError } from './errors.ts';
import { headerValue } from './headers.ts';

const GlanceOctokitBase = Octokit.plugin(paginateRest, retry, throttling);

/**
 * The longest a REST read waits out a rate limit before failing with
 * `RateLimitedError`. Past it, the wait is the daemon's to schedule: sleeping
 * inside a poll held the whole loop until the quota window reset.
 */
export const RATE_LIMIT_RETRY_DEADLINE_S = 30;

const MAX_RATE_LIMIT_RETRIES = 2;

/**
 * The `request` option key a GraphQL query sets to keep the retry plugin's
 * 5xx retries. Only `graphqlRead` may set it: it never sends a mutation.
 */
export const GRAPHQL_READ_MARKER = 'glanceGraphQLRead';

export type GlanceOctokit = InstanceType<typeof GlanceOctokitBase>;

/**
 * GitHub Enterprise serves REST under /api/v3 but GraphQL under /api/graphql,
 * not beneath the REST root, so the two cannot be derived from one prefix.
 *
 * `graphqlURL` is no longer read anywhere in `src/` -- `GitHubProvider`'s
 * GraphQL helpers call `octokit.graphql`, which derives the same value
 * itself from the REST `apiBase` (see `@octokit/graphql`'s
 * `GHES_V3_SUFFIX_REGEX`). It stays here, and its own test in
 * `github-client.test.ts` stays with it, as a standalone spec of the split
 * this function's docstring describes: it is the value `octokit.graphql`
 * is expected to arrive at independently, and losing this pin would remove
 * the one place that fact is written down and checked.
 */
export function resolveGitHubUrls(baseURL: string): {
  apiBase: string;
  graphqlURL: string;
} {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return {
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    };
  }
  return {
    apiBase: `${baseURL}/api/v3`,
    graphqlURL: `${baseURL}/api/graphql`
  };
}

export function createGitHubClient(opts: {
  baseURL: string;
  token: string;
  log: ForgeLogger;
  onRequest?: OnRequestHook;
}): GlanceOctokit {
  const { apiBase } = resolveGitHubUrls(opts.baseURL);

  const octokit = new GlanceOctokitBase({
    auth: opts.token,
    baseUrl: apiBase,
    throttle: {
      // `@octokit/plugin-throttling` keys its rate-limit Bottleneck groups
      // in module-scope singletons (`groups.write`, `groups.global`, ...),
      // defaulting every caller to the same `id: "no-id"` when none is
      // given. Without a per-instance id here, two `GitHubProvider`s for
      // different hosts and tokens would throttle and pace each other
      // process-wide even though they share no actual rate-limit budget.
      // This only decouples that bookkeeping; the pacing rules themselves
      // (minTime, maxConcurrent) are unchanged. The token is hashed rather
      // than embedded raw: Bottleneck's `Group` keeps this id as an
      // enumerable key (`group.limiters()`), and although the plugin never
      // logs it, this repo is public and the package is published, so the
      // key must not carry a live credential even in a form nothing
      // currently prints.
      id: `${apiBase}::${hashToken(opts.token)}`,
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        if (isGraphQLRequest(options)) {
          // A GraphQL read throws `RateLimitedError` at once so the daemon
          // schedules the wait; a mutation fails with the limit for its
          // caller to retry. Retrying here would wait out
          // `x-ratelimit-reset` in real time, up to roughly two hours for a
          // primary rate limit, twice, before failing the same way.
          return false;
        }
        // Two attempts absorb a quota window boundary. Retrying indefinitely
        // would turn a quota exhaustion into a hang with no upper bound.
        return shouldRetry(options, retryAfter, retryCount);
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub secondary rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        if (isGraphQLRequest(options)) {
          // Same reasoning as `onRateLimit` above: waiting out
          // `retry-after` (or the 60s fallback), up to twice, would hold the
          // caller past the deadline reads have.
          return false;
        }
        return shouldRetry(options, retryAfter, retryCount);
      }
    },
    retry: {
      // The retry plugin backs off 429s on its own 1s, 4s, 9s ladder and
      // ignores Retry-After, which spends ~14s on a limit the throttling
      // handlers above already judged past the deadline. A 429 is always a
      // rate limit: the throttling handlers take the ones GitHub labels
      // (secondary-limit text, or `x-ratelimit-remaining: 0`), and
      // `toRateLimitedError` turns every other 429 on a read into a
      // `RateLimitedError`, so none is left to this ladder.
      doNotRetry: [400, 401, 403, 404, 410, 422, 429, 451]
    }
  });

  // Octokit reads a fetch aborted by a caller's signal as a status 500
  // RequestError, which the retry plugin then retries without checking the
  // signal, holding the caller through the whole backoff ladder. The plugin
  // sets each retry budget through `retryRequest`, so zeroing the budget for
  // an aborted signal is the one place that stops the retry without touching
  // any other request.
  const setRetryBudget = octokit.retry.retryRequest;
  octokit.retry.retryRequest = (error, retries, retryAfter) =>
    setRetryBudget(error, error.request.request?.signal?.aborted ? 0 : retries, retryAfter);

  // The retry plugin defaults to retrying 5xx responses for every verb,
  // including POST/PUT/PATCH/DELETE. A write that reaches GitHub and then
  // drops the response on a 502 gets retried, which can create a duplicate
  // PR, a duplicate approval, or a second merge attempt on top of one that
  // already succeeded. A duplicate write is a worse failure mode than a
  // request that surfaces as failed and must be retried by the caller, so
  // only the idempotent verbs (GET, HEAD) keep automatic retry; everything
  // else is forced to retries: 0 here, centrally, so no call site has to
  // remember to opt out. A GraphQL query is a POST but writes nothing, so
  // one carrying `GRAPHQL_READ_MARKER` keeps the 5xx retries: without them
  // one 502 fails a whole fill batch, and the daemon caches "no PR" for
  // every branch in it. The marker is explicit rather than inferred from
  // the query text, so a mutation can never be mistaken for a read.
  octokit.hook.before('request', options => {
    // endpoint.merge does not normalize case, so a caller that passes a
    // lowercase method (e.g. restRequest('get', ...)) would otherwise
    // silently keep retries enabled instead of falling into this guard.
    // Every in-repo call site already uses uppercase; this is defensive
    // for restRequest's external, undocumented-case contract.
    const method = options.method?.toUpperCase();
    const markedRead =
      options.request?.[GRAPHQL_READ_MARKER] === true && isGraphQLRequest(options);
    if (method && method !== 'GET' && method !== 'HEAD' && !markedRead) {
      options.request = { ...options.request, retries: 0 };
    }
  });

  // The hand-rolled fetch transport this replaces pinned every request to a
  // known REST version so a future GitHub version bump cannot silently
  // change response shapes underneath this SDK. Octokit sends no version
  // header on its own, and the Octokit constructor's top-level `headers`
  // option (which looks like the obvious place for this) is a red herring:
  // `@octokit/core`'s constructor never reads `options.headers` at all, so
  // setting it there is silently a no-op. The only headers it builds into
  // its request defaults are `user-agent` and `time-zone`, from the
  // `userAgent` and `timeZone` options -- see `@octokit/core`'s
  // `dist-src/index.js`. A `before` hook, the same
  // mechanism the `retries: 0` guard above already uses, is what actually
  // reaches every request the instance issues.
  octokit.hook.before('request', options => {
    options.headers['x-github-api-version'] = '2022-11-28';
  });

  if (opts.onRequest) {
    const started = new WeakMap<object, number>();
    octokit.hook.before('request', options => {
      started.set(options, performance.now());
    });
    octokit.hook.after('request', (response, options) => {
      emit(opts.onRequest!, started, options, response.status);
    });
    octokit.hook.error('request', (error, options) => {
      emit(
        opts.onRequest!,
        started,
        options,
        error instanceof RequestError ? error.status : 0
      );
      throw error;
    });
  }

  // Registered after the plugins and the instrumentation hook so it is the
  // outermost error hook: the throttling and retry plugins read the raw
  // RequestError (status, headers) to decide whether to wait, and the
  // instrumentation hook above reports its status. Only what survives all of
  // them is converted. REST reads only: a rejected write keeps its
  // RequestError so `ghError` still shapes its message, and a GraphQL error
  // reaches `graphqlRead` unconverted, since a rate limit there can arrive
  // in a 200 body this hook never sees as an error; it converts for itself.
  octokit.hook.error('request', (error, options) => {
    const method = options.method?.toUpperCase();
    if ((method === 'GET' || method === 'HEAD') && !isGraphQLRequest(options)) {
      const limited = toRateLimitedError(error, `${method} ${options.url}`);
      if (limited) throw limited;
    }
    throw error;
  });

  return octokit;
}

/**
 * The 30s deadline binds reads only, which is what a poll waits on. A write
 * keeps waiting out the reset (twice at most): a mutation the caller asked
 * for is worth the wait, and its failure is not recoverable by polling later.
 */
function shouldRetry(
  options: { method?: string },
  retryAfterSeconds: number,
  retryCount: number
): boolean {
  if (retryCount >= MAX_RATE_LIMIT_RETRIES) return false;
  const method = options.method?.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  return !isRead || retryAfterSeconds <= RATE_LIMIT_RETRY_DEADLINE_S;
}

function hasGraphQLRateLimit(err: object): boolean {
  const e = err as {
    errors?: unknown;
    data?: { errors?: unknown };
    response?: { data?: { errors?: unknown } };
  };
  return [e.errors, e.data?.errors, e.response?.data?.errors].some(
    list =>
      Array.isArray(list) &&
      list.some(item => (item as { type?: unknown } | null)?.type === 'RATE_LIMITED')
  );
}

const SECONDARY_LIMIT_DEFAULT_WAIT_MS = 60_000;

/**
 * Recognise a GitHub rate limit in a thrown error, or return null.
 *
 * REST: a 403 or 429 is a primary limit when it names `x-ratelimit-remaining:
 * 0`, and a secondary limit when its message says so, when it carries
 * `retry-after`, or when it is a bare 429. GraphQL: a `RATE_LIMITED` entry in
 * the errors, which GitHub returns with a 200, so there is no status to read.
 *
 * The wait is `retry-after` when present. Otherwise a primary limit waits for
 * its reset, and a secondary limit with quota left waits one minute with
 * `resetAt` null: the primary window says nothing about a secondary limit.
 */
export function toRateLimitedError(
  err: unknown,
  operation: string
): RateLimitedError | null {
  if (err instanceof RateLimitedError) return err;
  if (!err || typeof err !== 'object') return null;

  const e = err as {
    status?: unknown;
    message?: unknown;
    headers?: unknown;
    response?: { status?: unknown; headers?: unknown; data?: { message?: unknown } };
  };
  const headers = e.response?.headers ?? e.headers;

  let kind: 'primary' | 'secondary' | null = null;
  if (hasGraphQLRateLimit(err)) {
    kind = 'primary';
  } else {
    const status = e.status ?? e.response?.status;
    if (status !== 403 && status !== 429) return null;
    const text = `${e.message ?? ''} ${e.response?.data?.message ?? ''}`;
    if (/\b(secondary|abuse) rate limit/i.test(text)) kind = 'secondary';
    else if (headerValue(headers, 'x-ratelimit-remaining') === '0') kind = 'primary';
    else if (headerValue(headers, 'retry-after') !== null) kind = 'secondary';
    else if (status === 429) kind = 'secondary';
  }
  if (kind === null) return null;

  const resetSeconds = Number(headerValue(headers, 'x-ratelimit-reset'));
  const primaryResetAt =
    Number.isFinite(resetSeconds) && resetSeconds > 0
      ? new Date(resetSeconds * 1000).toISOString()
      : null;
  const retryAfterSeconds = Number(headerValue(headers, 'retry-after'));
  const primaryExhausted =
    kind === 'primary' || headerValue(headers, 'x-ratelimit-remaining') === '0';
  const unhinted = !(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0);
  const resetAt = primaryExhausted ? primaryResetAt : null;
  const retryAfterMs = !unhinted
    ? retryAfterSeconds * 1000
    : !primaryExhausted
      ? SECONDARY_LIMIT_DEFAULT_WAIT_MS
      : resetAt !== null
        ? Math.max(0, Date.parse(resetAt) - Date.now())
        : null;

  return new RateLimitedError(
    `GitHub ${kind} rate limit hit on ${operation}${resetAt ? `; resets at ${resetAt}` : ''}`,
    { kind, resetAt, retryAfterMs, operation, cause: err }
  );
}

/**
 * A GraphQL request's URL is either the relative `/graphql` (github.com) or
 * the rewritten absolute `.../api/graphql` (GHES) -- see
 * `resolveGitHubUrls`'s docstring and `@octokit/graphql`'s
 * `GHES_V3_SUFFIX_REGEX`. This has to match the *pathname* exactly, not just
 * check whether the URL contains the substring "/graphql": at this hook,
 * `options.url` is already interpolated with real path segments, not a
 * route template, so a REST request can legitimately contain that substring
 * -- `GET /repos/graphql/graphql-js/pulls` (a real GitHub org and repo), any
 * repository or branch literally named "graphql" (e.g.
 * `/git/refs/heads/graphql`), or any caller-supplied `restRequest` path.
 * A substring match on those would wrongly skip the REST rate-limit retry
 * this phase adopted Octokit for, and wrongly label them `transport:
 * 'graphql'`. Matching the exact pathname is the same check the throttling
 * plugin itself uses (`pathname.startsWith('/graphql')` in
 * `wrap-request.js`), just also covering the GHES `/api/graphql` form.
 */
function isGraphQLRequest(options: { url?: string }): boolean {
  const { pathname } = new URL(options.url ?? '', 'http://placeholder.invalid');
  return pathname === '/graphql' || pathname.endsWith('/api/graphql');
}

/**
 * A non-secret discriminator for the throttle group key -- see the
 * `throttle.id` comment above. It only needs to distinguish tokens from each
 * other, not resist attack, so a 64-bit FNV-1a in pure JS is enough. It must
 * stay free of Node built-ins: the glance root bundle is also loaded in
 * browsers.
 */
export function hashToken(token: string): string {
  const mask = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(token)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function emit(
  hook: OnRequestHook,
  started: WeakMap<object, number>,
  options: { method?: string; url?: string },
  status: number
): void {
  const at = started.get(options as object);
  safeEmit(hook, {
    op: `gh.${options.method ?? 'GET'} ${options.url ?? ''}`.trim(),
    transport: isGraphQLRequest(options) ? 'graphql' : 'rest',
    method: options.method ?? 'GET',
    path: options.url ?? '',
    durationMs: at === undefined ? 0 : performance.now() - at,
    status
  });
}

/**
 * Translate a thrown Octokit error into the message shape callers already
 * match on.
 *
 * The live conformance harness pattern-matches three of these to distinguish a
 * transient failure from a permanent one, so a reworded message disables a
 * check silently instead of failing it. `style` picks between the two formats
 * the hand-rolled code used: most methods emitted status plus body, five
 * emitted status, statusText, and body.
 */
export function ghError(
  op: string,
  err: unknown,
  style: 'plain' | 'statusText' = 'plain'
): Error {
  if (!(err instanceof RequestError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const body = bodyText(err);
  if (style === 'statusText') {
    // The dash here is GitHub-facing text this SDK has always emitted in these
    // five messages, and the harness matches on the prefix before it.
    return new Error(
      `${op} failed: ${err.status} ${statusText(err)}${body ? ` — ${body}` : ''}`
    );
  }
  return new Error(`${op} failed: ${err.status} ${body}`);
}

/**
 * Exported so GitHubProvider.ts can build its `sourceBranchNotDeleted`
 * reasons with the same body text `ghError` would use, without going through
 * `ghError` itself: a reason is not an `${op} failed:` message, so
 * `ghError`'s shape does not fit.
 */
export function bodyText(err: RequestError): string {
  const data = err.response?.data;
  if (data === undefined || data === null) {
    // A network-level failure (DNS, connection refused, and so on) has no
    // response at all, so the only surviving diagnostic is the message
    // Octokit itself threw with. Losing it here would make this branch
    // strictly worse than the non-RequestError branch above, which keeps it.
    return err.response === undefined ? err.message : '';
  }
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * Reason phrases for the statuses this SDK actually surfaces.
 *
 * Octokit's fetch wrapper reads `fetchResponse.statusText` only to build its
 * thrown error and never copies it onto `response.headers`, so there is no
 * "404 Not Found" style header to recover it from at this point, unlike the
 * hand-rolled fetch code this replaces. These five messages are quoted
 * verbatim in two specs documents, so the text is reconstructed from the
 * status code instead of read off a header that no longer exists.
 */
const REASON_PHRASES: Record<number, string> = {
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable'
};

function statusText(err: RequestError): string {
  return reasonPhrase(err.status);
}

/**
 * Exported so `api()` in GitHubProvider.ts can populate `Response.statusText`
 * without duplicating this map. `new Response(body, { status })` leaves
 * `statusText` empty, and the messages this SDK emits read
 * `${res.status} ${res.statusText}`, so an empty statusText renders a double
 * space and drops the reason phrase.
 */
export function reasonPhrase(status: number): string {
  // An unmapped status degrades to the current (empty) behavior rather than
  // inventing text for a status this SDK has not been observed to surface.
  return REASON_PHRASES[status] ?? '';
}
