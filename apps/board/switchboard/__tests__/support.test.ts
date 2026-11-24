import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import * as client from '@mattstack/rt-client';
import { makeFetchHandler } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import * as relay from '../support.ts';
import { TeamInviteStore } from '../team-invites.ts';
import { TelemetryStore } from '../telemetry.ts';
import { InboxWaiters, MAX_WAITERS_PER_BOARD } from '../waiters.ts';

const MINUTE = 60_000;

function setup() {
  const clock = { t: 1000 };
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const waiters = new InboxWaiters();
  const supportWaiters = new InboxWaiters();
  const handler = makeFetchHandler(
    store,
    'admin-secret',
    () => clock.t,
    new TeamInviteStore(db),
    new TelemetryStore(db),
    null,
    waiters,
    supportWaiters
  );
  const call = (
    path: string,
    opts: {
      method?: string;
      token?: string;
      body?: unknown;
      signal?: AbortSignal;
    } = {}
  ) =>
    handler(
      new Request(`http://x${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'content-type': 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      })
    );
  const ada = store.registerBoard('ada').token;
  const alex = store.registerBoard('alex').token;
  const bo = store.registerBoard('bo').token;
  const post = (token: string, d: client.SupportDraft) =>
    call('/support/messages', { token, body: d });
  const list = async (
    token: string,
    kind: client.SupportKind = 'request',
    machine = 'mac-1'
  ) =>
    (
      (await (
        await call(
          `/support/messages?kind=${kind}${kind === 'request' ? `&machine=${machine}` : ''}`,
          { token }
        )
      ).json()) as { messages: client.SupportMessage[] }
    ).messages;
  const accept = (token: string, machine: string, accepting = true) =>
    call('/support/host', {
      method: 'PUT',
      token,
      body: { accepting, machine },
    });
  const hostOf = async (username: string) =>
    (await (
      await call(`/support/host/${username}`, { token: ada })
    ).json()) as client.SupportHostState;
  return {
    store,
    waiters,
    supportWaiters,
    call,
    post,
    list,
    accept,
    hostOf,
    ada,
    alex,
    bo,
    clock,
  };
}

const draft = (
  id: string,
  to = 'alex',
  over: Partial<client.SupportDraft> = {}
): client.SupportDraft => ({
  id,
  to,
  kind: 'request',
  sentAt: 1,
  body: '{"text":"help"}',
  mac: 'ab12',
  ...over,
});

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await Bun.sleep(1);
  if (!cond()) throw new Error('condition never held');
}

describe('support messages', () => {
  test('a request reaches only its recipient, with the sender taken from the token', async () => {
    const { post, list, ada, alex, bo } = setup();
    const forged = { ...draft('r1', ' Alex '), from: 'bo' };
    expect((await post(ada, forged)).status).toBe(201);
    const [got] = await list(alex);
    expect(got).toEqual({
      ...draft('r1'),
      from: 'ada',
      receivedAt: 1000,
    });
    expect(client.parseSupportMessage(got)).toEqual(got!);
    expect(await list(bo)).toEqual([]);
    expect(await list(ada)).toEqual([]);
  });

  test('the board inbox never holds a support message', async () => {
    const { post, call, ada, alex } = setup();
    await post(ada, draft('r1'));
    expect(await (await call('/inbox', { token: alex })).json()).toEqual({
      envelopes: [],
    });
  });

  test('the same id from two senders is two messages', async () => {
    const { post, list, ada, alex, bo } = setup();
    await post(ada, draft('r1'));
    await post(bo, draft('r1'));
    expect((await list(alex)).map(m => m.from).sort()).toEqual(['ada', 'bo']);
  });

  test("a repeat of one sender's id is one message", async () => {
    const { post, list, ada, alex, clock } = setup();
    expect((await post(ada, draft('r1'))).status).toBe(201);
    clock.t = 5000;
    expect((await post(ada, draft('r1'))).status).toBe(201);
    const got = await list(alex);
    expect(got).toHaveLength(1);
    expect(got[0]!.receivedAt).toBe(1000);
  });

  test("ack removes only the named sender's message", async () => {
    const { post, list, call, ada, alex, bo } = setup();
    await post(ada, draft('r1'));
    await post(bo, draft('r1'));
    const res = await call('/support/ack', {
      token: alex,
      body: { keys: [{ from: 'Ada', id: 'r1' }] },
    });
    expect(await res.json()).toEqual({ ok: true, acked: 1 });
    expect((await list(alex)).map(m => m.from)).toEqual(['bo']);
  });

  test("ack never removes another board's message", async () => {
    const { post, list, call, ada, alex, bo } = setup();
    await post(ada, draft('r1'));
    await call('/support/ack', {
      token: bo,
      body: { keys: [{ from: 'ada', id: 'r1' }] },
    });
    expect(await list(alex)).toHaveLength(1);
  });

  test('ack refuses anything but a list of sender and id', async () => {
    const { call, alex } = setup();
    for (const body of [{}, { keys: 'r1' }, { keys: [{ id: 'r1' }] }])
      expect((await call('/support/ack', { token: alex, body })).status).toBe(
        400
      );
  });

  test('listing by kind keeps requests and statuses apart', async () => {
    const { post, list, call, ada, alex } = setup();
    await post(ada, draft('r1'));
    await post(ada, draft('s1', 'alex', { kind: 'status' }));
    expect((await list(alex, 'request')).map(m => m.id)).toEqual(['r1']);
    expect((await list(alex, 'status')).map(m => m.id)).toEqual(['s1']);
    expect((await call('/support/messages', { token: alex })).status).toBe(400);
    expect(
      (await call('/support/messages?kind=other', { token: alex })).status
    ).toBe(400);
  });

  test('messages list in the order they arrived', async () => {
    const { post, list, ada, alex, bo } = setup();
    await post(bo, draft('r2'));
    await post(ada, draft('r1'));
    expect((await list(alex)).map(m => m.id)).toEqual(['r2', 'r1']);
  });

  test('a body over 64 KiB is 413', async () => {
    const { post, list, ada, alex } = setup();
    const big = draft('r1', 'alex', {
      body: 'x'.repeat(relay.SUPPORT_BODY_MAX_BYTES),
    });
    expect((await post(ada, big)).status).toBe(413);
    expect(await list(alex)).toEqual([]);
  });

  test('a malformed message is 400', async () => {
    const { call, ada } = setup();
    const bad = [
      draft(''),
      draft('x'.repeat(201)),
      draft('r1', '*'),
      draft('r1', ' '),
      { ...draft('r1'), kind: 'other' },
      { ...draft('r1'), sentAt: 'now' },
      { ...draft('r1'), body: {} },
      { ...draft('r1'), mac: '' },
      draft('\ud800'),
      draft('a b'),
      { ...draft('r1'), mac: 'é' },
      null,
    ];
    for (const body of bad)
      expect(
        (await call('/support/messages', { token: ada, body })).status
      ).toBe(400);
  });

  test('21 pending from one sender to one recipient is 429', async () => {
    const { post, list, ada, alex, bo } = setup();
    for (let i = 0; i < 20; i++)
      expect((await post(ada, draft(`r${i}`))).status).toBe(201);
    expect((await post(ada, draft('r20'))).status).toBe(429);
    expect((await post(ada, draft('r0'))).status).toBe(201);
    expect((await post(bo, draft('r20'))).status).toBe(201);
    expect((await post(ada, draft('r20', 'bo'))).status).toBe(201);
    expect(await list(alex)).toHaveLength(21);
  });

  test('an unknown recipient is 422 and a bad token 401', async () => {
    const { post, call, ada } = setup();
    expect((await post(ada, draft('r1', 'nobody'))).status).toBe(422);
    expect((await post('nope', draft('r1'))).status).toBe(401);
    expect((await call('/support/host/alex')).status).toBe(401);
  });

  test('everything listed can be acked, whatever ids a sender picked', async () => {
    const { post, list, call, ada, alex } = setup();
    const id = '0f8c-4a1e:already-waiting_x.y';
    for (const i of [id, 'x'.repeat(200), '\ud800\ud800'])
      await post(ada, draft(i));
    const keys = (await list(alex)).map(m => ({ from: m.from, id: m.id }));
    expect(keys.map(k => k.id).sort()).toEqual([id, 'x'.repeat(200)]);
    await call('/support/ack', { token: alex, body: { keys } });
    expect(await list(alex)).toEqual([]);
  });

  test('an unknown support route is 404', async () => {
    const { call, ada } = setup();
    expect((await call('/support/other', { token: ada })).status).toBe(404);
  });

  test('messages older than 7 days are pruned', async () => {
    const { store, post, list, ada, alex, clock } = setup();
    await post(ada, draft('old'));
    clock.t = 1000 + relay.SUPPORT_TTL_MS;
    await post(ada, draft('new'));
    store.support.prune(1001 + relay.SUPPORT_TTL_MS);
    expect((await list(alex)).map(m => m.id)).toEqual(['new']);
  });

  test('deleting a board drops its messages and host flag', async () => {
    const { store, post, list, accept, hostOf, ada, alex, bo } = setup();
    await post(ada, draft('r1'));
    await post(bo, draft('r1', 'ada'));
    await accept(alex, 'mac-1');
    store.deleteBoard('alex');
    const again = store.registerBoard('alex').token;
    expect(await list(again)).toEqual([]);
    expect(await hostOf('alex')).toEqual({
      accepting: false,
      lastSeenAt: null,
    });
    store.deleteBoard('bo');
    expect(await list(ada)).toEqual([]);
  });
});

describe('support host', () => {
  test('host defaults to not accepting', async () => {
    const { hostOf } = setup();
    expect(await hostOf('alex')).toEqual({
      accepting: false,
      lastSeenAt: null,
    });
    expect(await hostOf('nobody')).toEqual({
      accepting: false,
      lastSeenAt: null,
    });
  });

  test('accepting is read back under any spelling of the name', async () => {
    const { accept, hostOf, alex } = setup();
    expect((await accept(alex, 'mac-1')).status).toBe(200);
    expect(await hostOf('Alex')).toEqual({ accepting: true, lastSeenAt: 1000 });
  });

  test('a second machine is refused while the first was seen within 10 minutes', async () => {
    const { accept, hostOf, alex, clock } = setup();
    await accept(alex, 'mac-1');
    clock.t += 10 * MINUTE - 1;
    expect((await accept(alex, 'mac-2')).status).toBe(409);
    expect((await hostOf('alex')).lastSeenAt).toBe(1000);
  });

  test('a second machine takes over after 10 minutes', async () => {
    const { accept, hostOf, alex, clock } = setup();
    await accept(alex, 'mac-1');
    clock.t += 10 * MINUTE;
    expect((await accept(alex, 'mac-2')).status).toBe(200);
    expect(await hostOf('alex')).toEqual({
      accepting: true,
      lastSeenAt: clock.t,
    });
    expect((await accept(alex, 'mac-1')).status).toBe(409);
  });

  test('a second machine may accept once the first stopped', async () => {
    const { accept, alex } = setup();
    await accept(alex, 'mac-1');
    await accept(alex, 'mac-1', false);
    expect((await accept(alex, 'mac-2')).status).toBe(200);
  });

  test("a machine that is not accepting never turns another machine's flag off", async () => {
    const { accept, hostOf, alex, clock } = setup();
    await accept(alex, 'mac-1');
    clock.t += 60 * MINUTE;
    expect((await accept(alex, 'mac-2', false)).status).toBe(409);
    expect((await hostOf('alex')).accepting).toBe(true);
  });

  test('a malformed host body is 400', async () => {
    const { call, alex } = setup();
    for (const body of [
      {},
      { accepting: true },
      { accepting: 'yes', machine: 'mac-1' },
      { accepting: true, machine: ' ' },
      { accepting: true, machine: 'x'.repeat(201) },
    ])
      expect(
        (await call('/support/host', { method: 'PUT', token: alex, body }))
          .status
      ).toBe(400);
  });

  test('only a request poll from the accepting machine moves lastSeenAt', async () => {
    const { accept, list, call, hostOf, ada, alex, clock } = setup();
    await accept(alex, 'mac-1');
    clock.t = 2000;
    await list(alex, 'status');
    await list(ada, 'request');
    await call('/support/messages?kind=request&machine=mac-2', { token: alex });
    expect((await hostOf('alex')).lastSeenAt).toBe(1000);
    await list(alex, 'request', 'mac-1');
    expect((await hostOf('alex')).lastSeenAt).toBe(2000);
    clock.t = 3000;
    await call(
      '/support/wait?kind=request&machine=mac-1&since=9999999999&timeout=0',
      { token: alex }
    );
    expect((await hostOf('alex')).lastSeenAt).toBe(3000);
  });

  test('a request poll needs a machine, and is refused while another one accepts', async () => {
    const { accept, post, call, ada, alex } = setup();
    await post(ada, draft('r1'));
    await accept(alex, 'mac-1');
    const poll = (q: string) => call(`/support/${q}`, { token: alex });
    expect((await poll('messages?kind=request')).status).toBe(400);
    expect((await poll('messages?kind=request&machine=mac-2')).status).toBe(
      409
    );
    expect(
      (await poll('wait?kind=request&machine=mac-2&since=0&timeout=0')).status
    ).toBe(409);
    await accept(alex, 'mac-1', false);
    expect((await poll('messages?kind=request&machine=mac-2')).status).toBe(
      200
    );
  });
});

describe('support wait', () => {
  test('a parked wait wakes when a message arrives', async () => {
    const { post, call, supportWaiters, ada, alex } = setup();
    const parked = call(
      '/support/wait?kind=request&machine=mac-1&since=0&timeout=25',
      { token: alex }
    );
    await until(() => supportWaiters.count('request:alex') === 1);
    await post(ada, draft('r1'));
    expect(await (await parked).json()).toEqual({ woke: true, cursor: 1000 });
  });

  test('a waiting message answers at once, and one at the cursor does not', async () => {
    const { post, call, ada, alex } = setup();
    await post(ada, draft('r1'));
    const wait = async (since: number) =>
      await (
        await call(
          `/support/wait?kind=request&machine=mac-1&since=${since}&timeout=0`,
          { token: alex }
        )
      ).json();
    expect(await wait(0)).toEqual({ woke: true, cursor: 1000 });
    expect(await wait(1000)).toEqual({ woke: false, cursor: 1000 });
  });

  test('two messages in one millisecond carry two cursors', async () => {
    const { post, list, ada, alex } = setup();
    await post(ada, draft('r1'));
    await post(ada, draft('r2'));
    expect((await list(alex)).map(m => m.receivedAt)).toEqual([1000, 1001]);
  });

  test('a status does not wake a request wait', async () => {
    const { post, call, supportWaiters, ada, alex } = setup();
    const abort = new AbortController();
    const parked = call(
      '/support/wait?kind=request&machine=mac-1&since=0&timeout=25',
      { token: alex, signal: abort.signal }
    );
    await until(() => supportWaiters.count('request:alex') === 1);
    await post(ada, draft('s1', 'alex', { kind: 'status' }));
    expect(supportWaiters.count('request:alex')).toBe(1);
    abort.abort();
    expect(await (await parked).json()).toEqual({ woke: false, cursor: 0 });
  });

  test('support waits never evict a board wait', async () => {
    const { call, waiters, supportWaiters, alex } = setup();
    const abort = new AbortController();
    const board = call('/inbox/wait?since=0&timeout=25', {
      token: alex,
      signal: abort.signal,
    });
    await until(() => waiters.count('alex') === 1);
    const parked = [];
    for (let i = 0; i <= MAX_WAITERS_PER_BOARD; i++)
      parked.push(
        call('/support/wait?kind=status&since=0&timeout=25', {
          token: alex,
          signal: abort.signal,
        })
      );
    await until(
      () => supportWaiters.count('status:alex') === MAX_WAITERS_PER_BOARD
    );
    expect(waiters.count('alex')).toBe(1);
    abort.abort();
    await Promise.all([board, ...parked]);
  });

  test('a wait refuses a query that is not numbers', async () => {
    const { call, alex } = setup();
    for (const q of ['since=soon&timeout=1', 'since=0&timeout=-1'])
      expect(
        (await call(`/support/wait?kind=status&${q}`, { token: alex })).status
      ).toBe(400);
  });
});

describe('the wire the relay and the client both declare', () => {
  test('limits match', () => {
    expect(relay.SUPPORT_BODY_MAX_BYTES).toBe(client.SUPPORT_BODY_MAX_BYTES);
    expect(relay.SUPPORT_TTL_MS).toBe(client.SUPPORT_TTL_MS);
  });

  test('both parse a draft the same way', () => {
    for (const d of [
      draft('r1', ' Alex '),
      draft('s1', 'alex', { kind: 'status' }),
      draft(''),
      draft('x'.repeat(200)),
      draft('x'.repeat(201)),
      draft('\ud800'),
      { ...draft('r1'), mac: 'x'.repeat(256) },
      draft('r1', '*'),
      { ...draft('r1'), kind: 'other' },
      { ...draft('r1'), sentAt: Number.NaN },
      { ...draft('r1'), body: 1 },
      { ...draft('r1'), mac: 'x'.repeat(257) },
      null,
      'text',
    ])
      expect(client.parseSupportDraft(d)).toEqual(relay.parseSupportDraft(d));
    expect(relay.parseSupportDraft(draft('r1', ' Alex '))?.to).toBe('alex');
  });
});
