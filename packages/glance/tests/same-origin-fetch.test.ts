/**
 * `fetchSameOrigin` follows a redirect only within the origin it started on,
 * with fetch's own method and body rules for the hops it does follow.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { fetchSameOrigin } from '../src/sameOriginFetch.ts';
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
afterAll(() => server.stop(true));
beforeEach(() => {
  hits.length = 0;
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
    route = () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.2:1/x' } });
    const err = await fetchSameOrigin(`${BASE}/start`, post).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossOriginRedirectError);
    expect((err as CrossOriginRedirectError).status).toBe(302);
  });

  test('a scheme change on the same host is another origin', async () => {
    route = () => new Response(null, { status: 301, headers: { location: `https://127.0.0.1:${server.port}/x` } });
    await expect(fetchSameOrigin(`${BASE}/start`)).rejects.toBeInstanceOf(CrossOriginRedirectError);
  });

  test("redirect 'manual' is passed straight through", async () => {
    route = hop(302);
    const res = await fetchSameOrigin(`${BASE}/start`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(hits).toHaveLength(1);
  });
});
