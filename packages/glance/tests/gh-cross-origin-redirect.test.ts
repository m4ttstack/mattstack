/**
 * A GitHub host that redirects to another origin never gets the token carried
 * there. Octokit sends the token as `Authorization` and leaves fetch on its
 * default redirect following; fetch drops `Authorization` on a cross-origin
 * hop. Two real local servers stand in for a GHES host and the other origin,
 * and each test also proves the redirect was followed, so a pass is never a
 * request that simply never left.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const TOKEN = 'ghp_redirectTestToken000000000000000000';

interface Seen {
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
    const headers = [...req.headers.values()].join('\n');
    otherSeen.push({ method: req.method, path: url.pathname, carriedToken: headers.includes(TOKEN) });
    return Response.json({ login: 'ada', id: 1, name: 'Ada', avatar_url: null, data: { viewer: { login: 'ada' } } });
  },
});

let status = 302;
const hostAuth: string[] = [];
const host = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    hostAuth.push(req.headers.get('authorization') ?? '');
    return new Response(null, { status, headers: { location: `http://127.0.0.1:${other.port}${url.pathname}` } });
  },
});

afterAll(() => {
  host.stop(true);
  other.stop(true);
});
beforeEach(() => {
  otherSeen.length = 0;
  hostAuth.length = 0;
  status = 302;
});

/** The GitHub host itself got the token, so a clean other origin means it was dropped, not never sent. */
const hostGotToken = () => expect(hostAuth.map((a) => a.includes(TOKEN))).toEqual([true]);

const provider = () => new GitHubProvider(`http://127.0.0.1:${host.port}`, TOKEN);

describe('a GitHub host redirecting to another origin', () => {
  test('a REST read follows it without the token', async () => {
    const user = await provider().fetchUser('ada');
    expect(user).not.toBeNull();
    expect(otherSeen).toEqual([{ method: 'GET', path: '/api/v3/users/ada', carriedToken: false }]);
    hostGotToken();
  });

  test('a REST write sent on through a 307 arrives without the token', async () => {
    status = 307;
    await provider().restRequest('POST', '/repos/o/r/issues/1/comments', { body: 'hi' });
    expect(otherSeen).toEqual([{ method: 'POST', path: '/api/v3/repos/o/r/issues/1/comments', carriedToken: false }]);
    hostGotToken();
  });

  test('a GraphQL query sent on through a 307 arrives without the token', async () => {
    status = 307;
    const gql = provider() as unknown as {
      graphqlOrThrow: (op: string, q: string, v: Record<string, unknown>) => Promise<unknown>;
    };
    await gql.graphqlOrThrow('viewer', 'query { viewer { login } }', {});
    expect(otherSeen).toEqual([{ method: 'POST', path: '/api/graphql', carriedToken: false }]);
    hostGotToken();
  });
});
