import { describe, expect, it } from 'vitest';

import { ApiError, isNotFound, readApiError, retryOnce } from './useRuns';

const res = (status: number, body: unknown) => ({
  status,
  json: async () => body,
});

describe('readApiError', () => {
  it('carries the body’s error text and the status', async () => {
    const err = await readApiError(
      res(502, { error: 'daemon unreachable' }),
      'run detail failed'
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('daemon unreachable');
    expect(err.status).toBe(502);
  });

  it('falls back to the label and status when the body says nothing', async () => {
    const err = await readApiError(res(500, null), 'run detail failed');
    expect(err.message).toBe('run detail failed: 500');
    const unreadable = await readApiError(
      {
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      },
      'runs list failed'
    );
    expect(unreadable.message).toBe('runs list failed: 502');
  });
});

describe('retryOnce', () => {
  it('retries a server failure once, then stops', () => {
    const outage = new ApiError(502, 'daemon unreachable');
    expect(retryOnce(0, outage)).toBe(true);
    expect(retryOnce(1, outage)).toBe(false);
  });

  it('never retries a 404 or another 4xx', () => {
    expect(retryOnce(0, new ApiError(404, 'run not found'))).toBe(false);
    expect(retryOnce(0, new ApiError(403, 'read-only'))).toBe(false);
  });

  it('retries a network failure once', () => {
    expect(retryOnce(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryOnce(1, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('isNotFound', () => {
  it('is true only for a 404', () => {
    expect(isNotFound(new ApiError(404, 'run not found'))).toBe(true);
    expect(isNotFound(new ApiError(502, 'daemon unreachable'))).toBe(false);
    expect(isNotFound(new Error('x'))).toBe(false);
  });
});
