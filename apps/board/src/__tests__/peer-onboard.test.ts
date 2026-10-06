import { describe, expect, test } from 'bun:test';

import { listPeerBoards } from '../peer/onboard.ts';

const fakeFetch = (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) =>
  (async (u: Parameters<typeof fetch>[0], i?: RequestInit) =>
    handler(String(u), i)) as unknown as typeof fetch;

describe('listPeerBoards', () => {
  test('proxies GET /boards with the admin bearer', async () => {
    const f = fakeFetch((url, init) => {
      expect(url).toBe('https://x/boards');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer t' });
      return Response.json({ boards: [{ username: 'grace', createdAt: 1 }] });
    });
    const r = await listPeerBoards({
      url: 'https://x',
      adminToken: 't',
      fetchFn: f,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).boards.length).toBe(1);
  });
});
