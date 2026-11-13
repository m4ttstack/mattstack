/**
 * fetch, except that a redirect is followed only while it stays on the origin
 * the request started on.
 *
 * On a cross-origin redirect fetch drops `Authorization` but keeps every
 * custom header, GitLab's `PRIVATE-TOKEN` included, so the default `follow`
 * would hand the token to whatever origin a GitLab host points at. Hops are
 * followed here by hand instead, with fetch's own rules for the ones that
 * stay on the origin: up to 20 follows, a 303 (or a 301 or 302 on a POST)
 * resent as a GET with no body, anything else resent as it was.
 */
import { CrossOriginRedirectError } from './errors.ts';

const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type'];

export async function fetchSameOrigin(input: string | URL, init: RequestInit = {}): Promise<Response> {
  if (init.redirect === 'manual' || init.redirect === 'error') return fetch(input, init);

  const start = new URL(input);
  let url: string | URL = input;
  let hopInit: RequestInit = { ...init, redirect: 'manual' };
  for (let follows = 0; ; follows += 1) {
    const res = await fetch(url, hopInit);
    const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get('location') : null;
    if (location === null) return res;

    const next = new URL(location, url);
    await res.body?.cancel();
    if (next.origin !== start.origin) throw new CrossOriginRedirectError(start, next, res.status);
    if (follows === MAX_REDIRECTS) throw new TypeError('redirect count exceeded');

    const method = (hopInit.method ?? 'GET').toUpperCase();
    if ((res.status === 303 && method !== 'GET' && method !== 'HEAD') || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      const headers = new Headers(hopInit.headers);
      for (const name of BODY_HEADERS) headers.delete(name);
      hopInit = { ...hopInit, method: 'GET', headers, body: undefined };
    }
    url = next;
  }
}
