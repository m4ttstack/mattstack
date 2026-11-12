import { beforeEach, describe, expect, it } from 'vitest';

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
});

