/**
 * A GitLab host that answers with a redirect to another origin never gets the
 * token carried there. Two real local servers stand in for the GitLab host and
 * the other origin, so real fetch redirect handling is what runs: fetch drops
 * `Authorization` on a cross-origin redirect but keeps `PRIVATE-TOKEN`.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { MRDetailFetcher } from '../src/MRDetailFetcher.ts';
import { NoteMutator } from '../src/NoteMutator.ts';
import { CrossOriginRedirectError } from '../src/index.ts';

const TOKEN = 'glpat-redirect-test-token';

interface Seen {
  method: string;
  path: string;
  carriedToken: boolean;
}

interface HostHit {
  method: string;
  path: string;
  carriedToken: boolean;
}

const otherSeen: Seen[] = [];
const other = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    otherSeen.push({
      method: req.method,
      path: url.pathname,
      carriedToken: req.headers.get('private-token') === TOKEN || (req.headers.get('authorization') ?? '').includes(TOKEN),
    });
    return Response.json({ id: 1, username: 'x' });
  },
});

type Route = (req: Request, url: URL) => Response | Promise<Response>;
let route: Route = () => new Response('unset', { status: 500 });
const hostSeen: HostHit[] = [];
const host = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    hostSeen.push({ method: req.method, path: url.pathname, carriedToken: req.headers.get('private-token') === TOKEN });
    return route(req, url);
  },
});

afterAll(() => {
  host.stop(true);
  other.stop(true);
});

beforeEach(() => {
  otherSeen.length = 0;
  hostSeen.length = 0;
});

const HOST = `http://127.0.0.1:${host.port}`;
const OTHER = `http://127.0.0.1:${other.port}`;

const toOther = (status = 302): Route => (_req, url) =>
  new Response(null, { status, headers: { location: `${OTHER}${url.pathname}${url.search}` } });

const provider = () => new GitLabProvider(HOST, TOKEN);
const mutator = () => new NoteMutator(HOST, TOKEN);

const PATHS: Array<[string, () => Promise<unknown>]> = [
  ['gitbeaker (fetchUser)', () => provider().fetchUser('ada')],
  ['restJson (fetchProject)', () => provider().fetchProject('g/p')],
  ['restRequest GET', () => provider().restRequest('GET', '/projects/1')],
  ['restRequest POST', () => provider().restRequest('POST', '/projects/1/notes', { body: 'hi' })],
  ['GraphQL (fetchPullRequests)', () => provider().fetchPullRequests({ projectPath: 'g/p', state: 'opened' })],
  ['MRDetailFetcher.fetchDetail', () => new MRDetailFetcher(HOST, TOKEN).fetchDetail(1, 7)],
  ['NoteMutator.fetchDiffRefs', () => mutator().fetchDiffRefs('g/p', 7)],
  ['NoteMutator.createNote', () => mutator().createNote('g/p', 7, 'hi')],
  ['NoteMutator.uploadFile', () => mutator().uploadFile('g/p', 'a.png', new Uint8Array([1]))],
];

describe('a GitLab host redirecting to another origin', () => {
  test.each(PATHS)('%s refuses to follow, so the token never reaches the other origin', async (_name, call) => {
    route = toOther(302);
    const err = await call().then(
      () => null,
      (e: unknown) => e,
    );
    expect(otherSeen).toEqual([]);
    expect(err).toBeInstanceOf(CrossOriginRedirectError);
    const e = err as CrossOriginRedirectError;
    expect(e.fromHost).toBe(`127.0.0.1:${host.port}`);
    expect(e.toHost).toBe(`127.0.0.1:${other.port}`);
    expect(e.message).toContain(`127.0.0.1:${host.port}`);
    expect(e.message).toContain(`127.0.0.1:${other.port}`);
    expect(e.message).not.toContain(TOKEN);
    expect(hostSeen).toHaveLength(1);
  });

  test.each(PATHS.filter(([name]) => name !== 'GraphQL (fetchPullRequests)'))(
    '%s sends the token to the GitLab host itself',
    async (_name, call) => {
      route = toOther(302);
      await call().catch(() => undefined);
      expect(hostSeen.map((s) => s.carriedToken)).toEqual([true]);
    },
  );

  test('a hop to another origin after a same-origin hop is still refused', async () => {
    route = (_req, url) =>
      url.pathname.startsWith('/moved')
        ? new Response(null, { status: 302, headers: { location: `${OTHER}${url.pathname}` } })
        : new Response(null, { status: 302, headers: { location: `/moved${url.pathname}` } });
    const err = await provider().restRequest('GET', '/projects/1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossOriginRedirectError);
    expect(hostSeen.map((s) => s.path)).toEqual(['/api/v4/projects/1', '/moved/api/v4/projects/1']);
    expect(otherSeen).toEqual([]);
  });

  test('a 307 on a write is refused the same way', async () => {
    route = toOther(307);
    const err = await mutator().createNote('g/p', 7, 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossOriginRedirectError);
    expect(otherSeen).toEqual([]);
  });

  test('restRequest with redirect manual still hands the 3xx back untouched', async () => {
    route = toOther(302);
    const res = await provider().restRequest('GET', '/projects/1', undefined, 'restRequest', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${OTHER}/api/v4/projects/1`);
    expect(otherSeen).toEqual([]);
  });
});

describe('a GitLab host redirecting within its own origin', () => {
  const sameOrigin = (final: (req: Request, url: URL) => Response): Route => (req, url) =>
    url.pathname.startsWith('/moved')
      ? final(req, url)
      : new Response(null, { status: 302, headers: { location: `/moved${url.pathname}${url.search}` } });

  test('gitbeaker follows it, with the token on both hops', async () => {
    route = sameOrigin(() => Response.json([{ id: 9, username: 'ada', name: 'Ada', avatar_url: null }]));
    const user = await provider().fetchUser('ada');
    expect(user?.username).toBe('ada');
    expect(hostSeen).toEqual([
      { method: 'GET', path: '/api/v4/users', carriedToken: true },
      { method: 'GET', path: '/moved/api/v4/users', carriedToken: true },
    ]);
  });

  test('restJson follows it', async () => {
    route = sameOrigin(() => Response.json({ id: 5, path_with_namespace: 'g/p' }));
    expect(await provider().fetchProject('g/p')).toEqual({ id: 'gitlab:5', fullPath: 'g/p' });
  });

  test('restRequest follows it, with the token on both hops', async () => {
    route = sameOrigin(() => Response.json({ ok: true }));
    const res = await provider().restRequest('GET', '/projects/1');
    expect(await res.json()).toEqual({ ok: true });
    expect(hostSeen.map((s) => s.carriedToken)).toEqual([true, true]);
  });

  test('GraphQL follows it', async () => {
    route = sameOrigin(() =>
      Response.json({ data: { project: { mergeRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
    );
    expect(await provider().fetchPullRequests({ projectPath: 'g/p', state: 'opened' })).toEqual([]);
    expect(hostSeen.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /api/graphql', 'GET /moved/api/graphql']);
  });

  test('MRDetailFetcher follows it', async () => {
    route = sameOrigin(() => Response.json([]));
    const detail = await new MRDetailFetcher(HOST, TOKEN).fetchDetail(1, 7);
    expect(detail).toBeDefined();
    expect(hostSeen).toHaveLength(2);
  });

  test('a 307 on a NoteMutator write resends the same method and body', async () => {
    const bodies: string[] = [];
    route = (req, url) => {
      if (!url.pathname.startsWith('/moved')) {
        return new Response(null, { status: 307, headers: { location: `/moved${url.pathname}` } });
      }
      return req.text().then((b) => {
        bodies.push(`${req.method} ${b}`);
        return Response.json(
          { id: 1, body: 'hi', author: { id: 1, username: 'u', name: 'U', avatar_url: null }, created_at: '2026-11-12T00:00:00Z' },
          { status: 201 },
        );
      });
    };
    await mutator().createNote('g/p', 7, 'hi');
    expect(bodies).toEqual([`POST ${JSON.stringify({ body: 'hi' })}`]);
    expect(otherSeen).toEqual([]);
  });
});
