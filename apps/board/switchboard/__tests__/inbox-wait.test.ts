import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { makeFetchHandler } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';
import { InboxWaiters, MAX_WAITERS_PER_BOARD } from '../waiters.ts';

const ADMIN = 'admin-secret';

function setup() {
  const clock = { t: 1000 };
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const waiters = new InboxWaiters();
  const handler = makeFetchHandler(
    store,
    ADMIN,
    () => clock.t,
    new TeamInviteStore(db),
    waiters
  );
  const call = (
    path: string,
    opts: { token?: string; body?: unknown; signal?: AbortSignal } = {}
  ) =>
    handler(
      new Request(`http://x${path}`, {
        method: opts.body !== undefined ? 'POST' : 'GET',
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'content-type': 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      })
    );
  const ada = store.registerBoard('ada').token;
  const grace = store.registerBoard('grace').token;
  return { store, waiters, call, ada, grace, clock };
}

const draft = (id: string, to: string) => ({
  id,
  to,
  type: 're-review-request',
  sentAt: 1,
  payload: {},
});

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await Bun.sleep(1);
  if (!cond()) throw new Error('condition never held');
}

describe('GET /inbox/wait', () => {
  test('needs a board token', async () => {
    const { call } = setup();
    expect((await call('/inbox/wait?since=0&timeout=0')).status).toBe(401);
  });

  test('rejects a query that is not a pair of numbers', async () => {
    const { call, ada } = setup();
    expect(
      (await call('/inbox/wait?since=soon&timeout=1', { token: ada })).status
    ).toBe(400);
    expect(
      (await call('/inbox/wait?since=0&timeout=-1', { token: ada })).status
    ).toBe(400);
  });

  test('returns at once when an unacked envelope is newer than since', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    const res = await call('/inbox/wait?since=0&timeout=25', { token: ada });
    expect(await res.json()).toEqual({ woke: true, cursor: 1000 });
  });

  test('a parked wait wakes on a publish to that board', async () => {
    const { call, ada, grace, clock, waiters } = setup();
    const pending = call('/inbox/wait?since=0&timeout=25', { token: ada });
    await until(() => waiters.count('ada') === 1);
    clock.t = 2000;
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    expect(await (await pending).json()).toEqual({ woke: true, cursor: 2000 });
    expect(waiters.count('ada')).toBe(0);
  });

  test('mail for another board does not wake this one', async () => {
    const { call, ada, waiters } = setup();
    const pending = call('/inbox/wait?since=0&timeout=0.05', { token: ada });
    await until(() => waiters.count('ada') === 1);
    await call('/envelopes', { token: ada, body: draft('e1', 'grace') });
    expect(await (await pending).json()).toEqual({ woke: false, cursor: 0 });
  });

  test('a broadcast wakes every other waiting board', async () => {
    const { call, ada, grace, waiters, store } = setup();
    const linus = store.registerBoard('linus').token;
    const a = call('/inbox/wait?since=0&timeout=25', { token: ada });
    const l = call('/inbox/wait?since=0&timeout=25', { token: linus });
    await until(
      () => waiters.count('ada') === 1 && waiters.count('linus') === 1
    );
    await call('/envelopes', { token: grace, body: draft('e1', '*') });
    expect(((await (await a).json()) as { woke: boolean }).woke).toBe(true);
    expect(((await (await l).json()) as { woke: boolean }).woke).toBe(true);
  });

  test('times out with the cursor unchanged', async () => {
    const { call, ada } = setup();
    const res = await call('/inbox/wait?since=500&timeout=0.05', {
      token: ada,
    });
    expect(await res.json()).toEqual({ woke: false, cursor: 500 });
  });

  test('never consumes: the envelope is still in /inbox after a wake', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    await call('/inbox/wait?since=0&timeout=0', { token: ada });
    const inbox = (await (await call('/inbox', { token: ada })).json()) as {
      envelopes: Array<{ id: string }>;
    };
    expect(inbox.envelopes.map(e => e.id)).toEqual(['e1']);
  });

  test('an acked envelope no longer wakes a wait', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    await call('/inbox/ack', { token: ada, body: { ids: ['e1'] } });
    const res = await call('/inbox/wait?since=0&timeout=0.05', { token: ada });
    expect(await res.json()).toEqual({ woke: false, cursor: 0 });
  });

  test('two publishes in the same millisecond get distinct cursors, so the second still wakes', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    const first = (await (
      await call('/inbox/wait?since=0&timeout=0', { token: ada })
    ).json()) as { cursor: number };
    await call('/envelopes', { token: grace, body: draft('e2', 'ada') });
    const second = await (
      await call(`/inbox/wait?since=${first.cursor}&timeout=0.05`, {
        token: ada,
      })
    ).json();
    expect(second).toEqual({ woke: true, cursor: first.cursor + 1 });
  });

  test('a disconnect drops the waiter', async () => {
    const { call, ada, waiters } = setup();
    const ctl = new AbortController();
    const pending = call('/inbox/wait?since=0&timeout=25', {
      token: ada,
      signal: ctl.signal,
    });
    await until(() => waiters.count('ada') === 1);
    ctl.abort();
    await pending.catch(() => undefined);
    expect(waiters.count('ada')).toBe(0);
  });
});

describe('InboxWaiters', () => {
  test('caps waiters per board, resolving the oldest as not woken', async () => {
    const w = new InboxWaiters();
    const never = new AbortController().signal;
    const first = w.wait('ada', 60_000, never);
    const rest = Array.from({ length: MAX_WAITERS_PER_BOARD }, () =>
      w.wait('ada', 60_000, never)
    );
    expect(await first).toBeNull();
    expect(w.count('ada')).toBe(MAX_WAITERS_PER_BOARD);
    w.wake(['ada'], 5);
    expect(await Promise.all(rest)).toEqual(
      Array(MAX_WAITERS_PER_BOARD).fill(5)
    );
    expect(w.count('ada')).toBe(0);
  });

  test('an already-aborted signal resolves at once without parking', async () => {
    const w = new InboxWaiters();
    const ctl = new AbortController();
    ctl.abort();
    expect(await w.wait('ada', 60_000, ctl.signal)).toBeNull();
    expect(w.count('ada')).toBe(0);
  });
});
