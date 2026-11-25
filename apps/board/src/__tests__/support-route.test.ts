import { describe, expect, test } from 'bun:test';

import { fromOperatorPage, isLocalRequest, requireJsonBody } from '../local.ts';
import { supportRoute, type SupportRouteDeps } from '../support.ts';

const ORIGIN = 'http://localhost:11006';
const loopback = { requestIP: () => ({ address: '127.0.0.1' }) };
const READY = {
  state: 'ready' as const,
  host: 'Alex Moreau',
  away: false,
  persona: 'Ada',
};

function route(over: Partial<SupportRouteDeps> = {}) {
  const calls: [string, unknown][] = [];
  const deps: SupportRouteDeps = {
    isLocal: req => isLocalRequest(req, loopback),
    fromPage: fromOperatorPage,
    requireJson: requireJsonBody,
    boardVersion: '0.1.8',
    hostDm: (username = 'ALEX') =>
      `https://slack.com/app_redirect?channel=U0${username}`,
    availability: async () => ({ ok: true, data: READY }),
    mine: async () =>
      ({ ok: true, data: { requests: [{ id: 'r1', peer: 'BEA' }] } }) as never,
    context: async a => {
      calls.push(['context', a]);
      return {
        ok: true,
        data: {
          parts: [{ key: 'versions', label: 'Versions', value: 'rt 1' }],
        },
      };
    },
    send: async a => {
      calls.push(['send', a]);
      return {
        ok: true,
        data: { request: { id: a.id, peer: 'BEA' } },
      } as never;
    },
    ...over,
  };
  const call = (path: string, init: RequestInit = {}) =>
    supportRoute(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: { host: 'localhost:11006', ...(init.headers as object) },
      }),
      deps
    );
  const post = (path: string, body: unknown, headers = {}) =>
    call(path, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { calls, call, post };
}

const BEA = 'https://slack.com/app_redirect?channel=U0BEA';
const ASK = { id: 'r1', text: 'no rows', parts: [] };

describe('reading', () => {
  test('who answers, what the agent goes by, and a DM with the host', async () => {
    const r = await route().call('/support');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({
      availability: READY,
      persona: 'Ada',
      hostDm: 'https://slack.com/app_redirect?channel=U0ALEX',
    });
  });

  test('nobody to ask still reads, under the default name', async () => {
    const r = await route({
      availability: async () => ({ ok: true, data: { state: 'hidden' } }),
      hostDm: () => null,
    }).call('/support');
    expect(await r.json()).toEqual({
      availability: { state: 'hidden' },
      persona: 'Maude',
      hostDm: null,
    });
  });

  test('each request opens a DM with the person it went to', async () => {
    const r = await route().call('/support/mine');
    expect(await r.json()).toEqual({
      requests: [{ id: 'r1', peer: 'BEA', hostDm: BEA }],
    });
  });

  test('a daemon that does not answer is a 502', async () => {
    const down = async () => ({ ok: false as const, error: 'unreachable' });
    const { call } = route({ availability: down, mine: down });
    for (const path of ['/support', '/support/mine']) {
      const r = await call(path);
      expect(r.status).toBe(502);
      expect(await r.json()).toEqual({
        code: 'no-answer',
        message: 'rt did not answer',
      });
    }
  });

  test('only a GET reads, and nothing else is served', async () => {
    const { post } = route();
    expect((await post('/support', {})).status).toBe(405);
    expect((await post('/support/other', {})).status).toBe(404);
  });
});

describe('sending', () => {
  test('passes the request on, and hands back what rt stored', async () => {
    const { calls, post } = route();
    const r = await post('/support/send', ASK);
    expect(await r.json()).toEqual({
      request: { id: 'r1', peer: 'BEA', hostDm: BEA },
    });
    expect(calls).toEqual([['send', ASK]]);
  });

  test("rt's own refusal carries its code, and a silence never says nothing was sent", async () => {
    const said = await route({
      send: async () => ({
        ok: false,
        error: 'x',
        failure: {
          code: 'support-unreachable',
          message: 'The relay did not answer.',
        },
      }),
    }).post('/support/send', ASK);
    expect(said.status).toBe(409);
    expect(await said.json()).toEqual({
      code: 'support-unreachable',
      message: 'The relay did not answer.',
    });
    for (const failure of [undefined, { code: 'timeout', message: 'slow' }]) {
      const r = await route({
        send: async () => ({ ok: false, error: 'x', failure }),
      }).post('/support/send', ASK);
      expect(r.status).toBe(502);
      expect(await r.json()).toMatchObject({ code: 'no-answer' });
    }
  });

  test("only the board's own page sends, as no plain shell call does", async () => {
    const { calls, call, post } = route();
    const bare = await call('/support/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ASK),
    });
    expect(bare.status).toBe(403);
    const foreign = await post('/support/send', ASK, {
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test('a body that is not a JSON object is refused before rt hears of it', async () => {
    const { calls, call, post } = route();
    const text = await post('/support/send', ASK, {
      'content-type': 'text/plain',
    });
    expect(text.status).toBe(415);
    expect((await post('/support/send', null)).status).toBe(400);
    const broken = await call('/support/send', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: '{',
    });
    expect(broken.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

test("what would be sent is asked for with the board's version, and the MR when there is one", async () => {
  const { calls, post } = route();
  const mr = {
    url: 'https://gitlab.example.com/acme/shop/-/merge_requests/1',
    state: 'ready',
  };
  const r = await post('/support/context', {});
  expect(await r.json()).toEqual({
    parts: [{ key: 'versions', label: 'Versions', value: 'rt 1' }],
  });
  await post('/support/context', { mr });
  expect(calls).toEqual([
    ['context', { board: '0.1.8' }],
    ['context', { mr, board: '0.1.8' }],
  ]);
});

test('a board read from elsewhere serves none of it', async () => {
  const { calls, call, post } = route({ isLocal: () => false });
  for (const path of ['/support', '/support/mine'])
    expect((await call(path)).status).toBe(403);
  for (const path of ['/support/context', '/support/send'])
    expect((await post(path, ASK)).status).toBe(403);
  expect(calls).toEqual([]);
});
