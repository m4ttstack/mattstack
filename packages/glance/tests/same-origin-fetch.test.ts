/**
 * `fetchSameOrigin` follows a redirect only within the origin it started on,
 * with fetch's own method and body rules for the hops it does follow.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { fetchSameOrigin, mayFollowRedirect } from '../src/sameOriginFetch.ts';
import { CrossOriginRedirectError } from '../src/errors.ts';

interface Hit {
  method: string;
  path: string;
  body: string;
  contentType: string | null;
}

const hits: Hit[] = [];
let route: (url: URL) => Response = () => new Response('unset', { status: 500 });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    hits.push({ method: req.method, path: url.pathname, body: await req.text(), contentType: req.headers.get('content-type') });
    return route(url);
  },
});
const elsewhereHits: string[] = [];
const elsewhere = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    elsewhereHits.push(new URL(req.url).pathname);
    return new Response('elsewhere');
  },
});
afterAll(() => {
  server.stop(true);
  elsewhere.stop(true);
});
beforeEach(() => {
  hits.length = 0;
  elsewhereHits.length = 0;
});

const BASE = `http://127.0.0.1:${server.port}`;
const hop = (status: number) => (url: URL) =>
  url.pathname === '/end' ? new Response('done') : new Response(null, { status, headers: { location: '/end' } });

const post = { method: 'POST', headers: { 'content-type': 'application/json', 'private-token': 't' }, body: '{"a":1}' };

describe('fetchSameOrigin', () => {
  test.each([301, 302, 303])('a %i on a POST resends as a GET with no body', async (status) => {
    route = hop(status);
    const res = await fetchSameOrigin(`${BASE}/start`, post);
    expect(await res.text()).toBe('done');
    expect(hits[1]).toEqual({ method: 'GET', path: '/end', body: '', contentType: null });
  });

  test.each([307, 308])('a %i on a POST resends the same method and body', async (status) => {
    route = hop(status);
    await fetchSameOrigin(`${BASE}/start`, post);
    expect(hits[1]).toEqual({ method: 'POST', path: '/end', body: '{"a":1}', contentType: 'application/json' });
  });

  test('a 302 on a PUT keeps the method and body', async () => {
    route = hop(302);
    await fetchSameOrigin(`${BASE}/start`, { ...post, method: 'PUT' });
    expect(hits[1]?.method).toBe('PUT');
    expect(hits[1]?.body).toBe('{"a":1}');
  });

  test('a FormData body survives a 307', async () => {
    route = hop(307);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([7])]), 'a.bin');
    await fetchSameOrigin(`${BASE}/start`, { method: 'POST', body: form });
    expect(hits[1]?.body).toContain('a.bin');
  });

  test('a 3xx with no location comes back as is', async () => {
    route = () => new Response(null, { status: 304 });
    expect((await fetchSameOrigin(`${BASE}/start`)).status).toBe(304);
    expect(hits).toHaveLength(1);
  });

  test('a redirect loop stops after 20 follows, as fetch does', async () => {
    route = (url) => new Response(null, { status: 302, headers: { location: url.pathname } });
    await expect(fetchSameOrigin(`${BASE}/loop`)).rejects.toThrow('redirect count exceeded');
    expect(hits).toHaveLength(21);
  });

  test('a hop to another origin is refused before any request goes there', async () => {
    route = () => new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${elsewhere.port}/x` } });
    const err = await fetchSameOrigin(`${BASE}/start`, post).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossOriginRedirectError);
    expect((err as CrossOriginRedirectError).status).toBe(302);
    expect((err as CrossOriginRedirectError).message).toContain(`http://127.0.0.1:${elsewhere.port}`);
    expect(elsewhereHits).toEqual([]);
  });

  test('a Location that does not parse throws a TypeError, as fetch does', async () => {
    route = () => new Response('body', { status: 302, headers: { location: 'http://[bad' } });
    await expect(fetchSameOrigin(`${BASE}/start`)).rejects.toBeInstanceOf(TypeError);
  });

  test('the caller signal still bounds the hops after a redirect', async () => {
    route = (url) =>
      url.pathname === '/end'
        ? (Bun.sleep(2_000).then(() => new Response('late')) as unknown as Response)
        : new Response(null, { status: 302, headers: { location: '/end' } });
    const started = performance.now();
    await expect(fetchSameOrigin(`${BASE}/start`, { signal: AbortSignal.timeout(150) })).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(hits.map((h) => h.path)).toEqual(['/start', '/end']);
  });

  test("redirect 'manual' is passed straight through", async () => {
    route = hop(302);
    const res = await fetchSameOrigin(`${BASE}/start`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(hits).toHaveLength(1);
  });
});

describe('mayFollowRedirect', () => {
  const u = (s: string) => new URL(s);
  test.each([
    ['the same origin', 'https://gl.example/a', 'https://gl.example/b', true],
    ['an http to https upgrade on the same host', 'http://gl.example/a', 'https://gl.example/a', true],
    ['an upgrade that also changes the port', 'http://gl.example/a', 'https://gl.example:8443/a', false],
    ['an https to http downgrade', 'https://gl.example/a', 'http://gl.example/a', false],
    ['another port', 'https://gl.example/a', 'https://gl.example:8443/a', false],
    ['another host', 'https://gl.example/a', 'https://other.example/a', false],
    ['a subdomain', 'https://gl.example/a', 'https://cdn.gl.example/a', false],
    ['an upgrade to another host', 'http://gl.example/a', 'https://other.example/a', false],
  ] as const)('%s', (_name, from, to, allowed) => {
    expect(mayFollowRedirect(u(from), u(to))).toBe(allowed);
  });
});
