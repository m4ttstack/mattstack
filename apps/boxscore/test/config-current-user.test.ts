import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCurrentUser,
  __setCurrentUser,
  getCurrentUser,
} from '../src/server/config/current-user.js';

const okFetch = (body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
    })) as unknown as typeof fetch;

beforeEach(() => __resetCurrentUser());

describe('getCurrentUser', () => {
  it('reads /api/v4/user once and caches', async () => {
    let calls = 0;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://gl.example/api/v4/user');
      expect((init?.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe(
        'tok'
      );
      return new Response(JSON.stringify({ username: 'ada', name: 'Ada L' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    expect(await getCurrentUser('https://gl.example', 'tok', f)).toEqual({
      username: 'ada',
      name: 'Ada L',
    });
    expect(await getCurrentUser('https://gl.example', 'tok', f)).toEqual({
      username: 'ada',
      name: 'Ada L',
    });
    expect(calls).toBe(1);
  });

  it('returns null on a non-2xx response and does not cache the failure', async () => {
    const denied = (async () =>
      new Response('', { status: 401 })) as unknown as typeof fetch;
    expect(
      await getCurrentUser('https://gl.example', 'tok', denied)
    ).toBeNull();
    expect(
      await getCurrentUser(
        'https://gl.example',
        'tok',
        okFetch({ username: 'ada', name: null })
      )
    ).toEqual({ username: 'ada', name: null });
  });

  it('returns null under vitest when no fetch is injected', async () => {
    expect(await getCurrentUser('https://gl.example', 'tok')).toBeNull();
  });

  it('reads the user again for a different host or token, never reusing another one', async () => {
    const alice = okFetch({ username: 'alice', name: null });
    const bob = okFetch({ username: 'bob', name: null });
    await getCurrentUser('https://gl.a.example', 'tok-a', alice);

    expect(
      (await getCurrentUser('https://gl.b.example', 'tok-a', bob))?.username
    ).toBe('bob');
    expect(
      (await getCurrentUser('https://gl.b.example', 'tok-b', alice))?.username
    ).toBe('alice');
  });

  it('a user set through __setCurrentUser answers for any host', async () => {
    __setCurrentUser({ username: 'pinned', name: null });

    expect(
      (await getCurrentUser('https://gl.other.example', 'tok'))?.username
    ).toBe('pinned');
  });

  it('github reads GET https://api.github.com/user with a Bearer token', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({ login: 'ada', name: 'Ada' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    expect(
      await getCurrentUser('https://github.com', 'tkn', f, 'github')
    ).toEqual({ username: 'ada', name: 'Ada' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.github.com/user');
    expect(seen[0]!.headers.Authorization).toBe('Bearer tkn');
    expect(seen[0]!.headers['PRIVATE-TOKEN']).toBeUndefined();
  });
});

describe('getCurrentUser on a GitLab host that redirects', () => {
  const TOKEN = 'fake-token-for-redirect-test';
  let other: Server;
  let host: Server;
  let otherHits: string[];
  let location: (path: string) => string;

  const listen = (handler: Parameters<typeof createServer>[1]) =>
    new Promise<Server>((resolve) => {
      const s = createServer(handler);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
  const origin = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  beforeEach(async () => {
    otherHits = [];
    vi.stubEnv('VITEST', '');
    other = await listen((req, res) => {
      otherHits.push(req.headers['private-token'] === undefined ? 'no token' : 'token');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ username: 'elsewhere', name: null }));
    });
    host = await listen((req, res) => {
      if (req.url?.startsWith('/moved/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ username: 'ada', name: null }));
        return;
      }
      res.writeHead(302, { location: location(req.url ?? '/') });
      res.end();
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all([other, host].map((s) => new Promise((r) => s.close(r))));
  });

  it('sends nothing to another origin and reads no user', async () => {
    location = (path) => `${origin(other)}${path}`;
    expect(await getCurrentUser(origin(host), TOKEN)).toBeNull();
    expect(otherHits).toEqual([]);
  });

  it('still follows a redirect on the same origin', async () => {
    location = (path) => `/moved${path}`;
    expect(await getCurrentUser(origin(host), TOKEN)).toEqual({ username: 'ada', name: null });
    expect(otherHits).toEqual([]);
  });
});
