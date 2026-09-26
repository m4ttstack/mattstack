import { describe, test, expect } from 'bun:test';
import { isAllowedOrigin, isLocalRequest } from '../src/server/local.ts';

function reqWithHost(host: string | null): Request {
  const headers = new Headers();
  if (host !== null) headers.set('host', host);
  return new Request('http://example/x', { headers });
}

describe('isLocalRequest', () => {
  test('localhost, 127.0.0.1, and *.localhost are local (port stripped, case-insensitive)', () => {
    expect(isLocalRequest(reqWithHost('localhost:7940'))).toBe(true);
    expect(isLocalRequest(reqWithHost('127.0.0.1'))).toBe(true);
    expect(isLocalRequest(reqWithHost('GITQ.localhost'))).toBe(true);
  });

  test('a public tunnel host and a missing host are not local', () => {
    expect(isLocalRequest(reqWithHost('gitq.m4tthew.dev'))).toBe(false);
    expect(isLocalRequest(reqWithHost(null))).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  test('no Origin header is allowed (same-origin fetches never set one)', () => {
    expect(isAllowedOrigin(null)).toBe(true);
  });

  test('a local Origin is allowed', () => {
    expect(isAllowedOrigin('http://localhost:7940')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:7940')).toBe(true);
    expect(isAllowedOrigin('http://gitq.localhost')).toBe(true);
  });

  test('a foreign Origin is rejected', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  test('a malformed Origin is rejected rather than thrown', () => {
    expect(isAllowedOrigin('not a url')).toBe(false);
  });
});
