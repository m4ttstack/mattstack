import { describe, test, expect } from 'bun:test';
import { isLocalRequest } from '../src/server/local.ts';

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
