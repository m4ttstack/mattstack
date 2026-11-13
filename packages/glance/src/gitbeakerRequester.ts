/**
 * The request handler glance gives gitbeaker in place of its default.
 *
 * Gitbeaker's own handler retries a 429 ten times on a 0.25ms to 128ms
 * ladder, all inside the window GitLab is refusing, then throws an error
 * with no headers, so the reset GitLab named is lost. It also resends a
 * write on a 502, which may already have been applied. This handler is the
 * default one with two changes: a 429 goes to `withGitLabRateLimit`, and
 * only a read is resent on a 502. Everything else (URL building, the
 * client-side rate limiter, body parsing, error shapes) matches gitbeaker
 * 43.8.0's `defaultRequestHandler`.
 */
import { GitbeakerRequestError, GitbeakerRetryError, GitbeakerTimeoutError } from '@gitbeaker/rest';
import {
  createRequesterFn,
  getMatchingRateLimiter,
  type FormattedResponse,
  type RateLimiters,
  type RequesterType,
  type ResourceOptions,
} from '@gitbeaker/requester-utils';
import { throwIfGitLabRateLimited, withGitLabRateLimit } from './gitlabRateLimit.ts';
import { fetchSameOrigin } from './sameOriginFetch.ts';

const MAX_502_ATTEMPTS = 10;

async function processBody(response: Response): Promise<FormattedResponse['body']> {
  const contentType = (response.headers.get('content-type') || '').split(';')[0]!.trim();
  if (contentType === 'application/json') return response.json().then((v) => (v || {}) as FormattedResponse['body']);
  if (contentType.startsWith('text/')) return response.text().then((t) => t || '');
  return response.blob();
}

async function parseResponse(response: Response, asStream: boolean): Promise<FormattedResponse> {
  const { status, headers: rawHeaders } = response;
  const headers: Record<string, string> = {};
  rawHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  const body = asStream
    ? (response.body as FormattedResponse['body'])
    : status === 204
      ? null
      : await processBody(response);
  return { body, headers, status };
}

async function throwFailedRequestError(request: Request, response: Response): Promise<never> {
  const content = await response.text();
  const contentType = response.headers.get('Content-Type');
  let description: string;
  if (contentType?.includes('application/json')) {
    const output = JSON.parse(content) as { error?: unknown; message?: unknown } | null;
    const contentProperty = output?.error || output?.message || '';
    description = typeof contentProperty === 'string' ? contentProperty : JSON.stringify(contentProperty);
  } else {
    description = content;
  }
  throw new GitbeakerRequestError(description, { cause: { description, request, response } });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function glanceRequestHandler(endpoint: string, options: Record<string, unknown> = {}): Promise<FormattedResponse> {
  const { rateLimiters, agent, asStream, prefixUrl, searchParams, method, ...opts } = options as {
    rateLimiters?: RateLimiters;
    agent?: unknown;
    asStream?: boolean;
    prefixUrl?: string;
    searchParams?: string;
    method?: string;
    signal?: AbortSignal;
  } & RequestInit;
  const verb = (method ?? 'GET').toUpperCase();
  const isRead = verb === 'GET' || verb === 'HEAD';
  const rateLimit = getMatchingRateLimiter(endpoint, rateLimiters, verb);
  const baseUrl = prefixUrl ? (prefixUrl.endsWith('/') ? prefixUrl : `${prefixUrl}/`) : undefined;
  const url = new URL(endpoint, baseUrl);
  url.search = searchParams || '';
  const mode: RequestMode | undefined = endpoint.includes('repository/archive') ? 'same-origin' : undefined;

  const send = async (): Promise<FormattedResponse> => {
    let lastStatus: number | undefined;
    for (let i = 0; i < MAX_502_ATTEMPTS; i += 1) {
      const init = { ...opts, method, mode, ...(agent ? { dispatcher: agent } : {}) } as RequestInit;
      const request = new Request(url, init);
      await rateLimit();
      const response = await fetchSameOrigin(url, init).catch((e: Error) => {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new GitbeakerTimeoutError('Query timeout was reached');
        throw e;
      });
      if (response.ok) return parseResponse(response, asStream ?? false);
      throwIfGitLabRateLimited(response);
      if (response.status !== 502 || !isRead) await throwFailedRequestError(request, response);
      lastStatus = response.status;
      await delay(2 ** i * 0.25);
    }
    throw new GitbeakerRetryError(
      `Could not successfully complete this request after ${MAX_502_ATTEMPTS} retries, last status code: ${lastStatus}. Verify the status of the endpoint.`,
    );
  };

  // The signal is gitbeaker's whole-call query timeout, which can also fire during a 429 wait.
  return withGitLabRateLimit(`${verb} ${endpoint}`, isRead ? 'read' : 'write', send, {
    signal: opts.signal ?? undefined,
  }).catch((e: unknown) => {
    const name = (e as { name?: unknown } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new GitbeakerTimeoutError('Query timeout was reached');
    throw e;
  });
}

export const glanceRequesterFn: (serviceOptions: ResourceOptions) => RequesterType = createRequesterFn(
  (_, requestOptions) => Promise.resolve(requestOptions),
  glanceRequestHandler,
);
