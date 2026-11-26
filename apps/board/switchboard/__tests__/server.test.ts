import { Database } from 'bun:sqlite';
import { describe, expect, spyOn, test } from 'bun:test';

import { ORG_TOKEN_RE, type OrgRow } from '../orgs.ts';
import { makeFetchHandler, masterTokenProblem } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';
import { TelemetryStore } from '../telemetry.ts';

const ADMIN = 'admin-secret';

function setup(
  db = new Database(':memory:'),
  master = ADMIN,
  prepare: (store: SwitchboardStore) => void = () => {}
) {
  const store = new SwitchboardStore(db);
  prepare(store);
  const handler = makeFetchHandler(
    store,
    master,
    () => 1000,
    new TeamInviteStore(db),
    new TelemetryStore(db),
    null
  );
  const call = (
    path: string,
    opts: { method?: string; token?: string; body?: unknown } = {}
  ) =>
    handler(
      new Request(`http://x${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'content-type': 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    );
  return { db, store, call };
}

const draft = (id: string, to: string) => ({
  id,
  to,
  type: 'review-state',
  sentAt: 1,
  payload: {},
});

describe('switchboard http', () => {
  test('healthz is open', async () => {
    const { call } = setup();
    expect((await call('/healthz')).status).toBe(200);
  });
  test('board registration needs the admin token', async () => {
    const { call } = setup();
    expect(
      (await call('/boards', { token: 'nope', body: { username: 'ada' } }))
        .status
    ).toBe(401);
    const res = await call('/boards', {
      token: ADMIN,
      body: { username: 'Ada' },
    });
    expect(res.status).toBe(201);
    const { username, token } = (await res.json()) as {
      username: string;
      token: string;
    };
    expect(username).toBe('ada');
    expect(token.length).toBeGreaterThan(20);
  });
  test('peers listing: any board token, usernames only, no tokens leaked', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    await call('/boards', { token: ADMIN, body: { username: 'grace' } });
    expect((await call('/peers')).status).toBe(401);
    expect((await call('/peers', { token: 'nope' })).status).toBe(401);
    const res = await call('/peers', { token: ada });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { peers: string[] };
    expect(body.peers.sort()).toEqual(['ada', 'grace']);
    expect(JSON.stringify(body)).not.toContain(ada);
  });

  test('board delete: admin-only, revokes the token, drops peers row and pending envelopes', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    const grace = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'grace' } })
      ).json()) as { token: string }
    ).token;
    await call('/envelopes', { token: ada, body: draft('e1', 'grace') });

    expect((await call('/boards/grace', { method: 'DELETE' })).status).toBe(
      401
    );
    expect(
      (await call('/boards/grace', { method: 'DELETE', token: 'nope' })).status
    ).toBe(401);
    expect(
      (await call('/boards/nobody', { method: 'DELETE', token: ADMIN })).status
    ).toBe(404);

    const res = await call('/boards/grace', { method: 'DELETE', token: ADMIN });
    expect(res.status).toBe(200);
    // Token dead immediately.
    expect((await call('/inbox', { token: grace })).status).toBe(401);
    // Gone from the enrollment listing.
    const peers = (await (await call('/peers', { token: ada })).json()) as {
      peers: string[];
    };
    expect(peers.peers).toEqual(['ada']);
    // Pending envelopes for the deleted board are dropped: re-register and
    // the inbox starts empty.
    const grace2 = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'grace' } })
      ).json()) as { token: string }
    ).token;
    const inbox = (await (await call('/inbox', { token: grace2 })).json()) as {
      envelopes: unknown[];
    };
    expect(inbox.envelopes).toEqual([]);
  });

  test('board delete with malformed percent-encoding answers 400, not a crash', async () => {
    const { call } = setup();
    const res = await call('/boards/%E0%A4', {
      method: 'DELETE',
      token: ADMIN,
    });
    expect(res.status).toBe(400);
  });

  test('publish → inbox → ack round trip', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    const grace = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'grace' } })
      ).json()) as { token: string }
    ).token;
    const pub = await call('/envelopes', {
      token: ada,
      body: draft('e1', 'grace'),
    });
    expect(pub.status).toBe(201);
    const inbox = (await (await call('/inbox', { token: grace })).json()) as {
      envelopes: Array<{ id: string; from: string; receivedAt: number }>;
    };
    expect(inbox.envelopes.map(e => e.id)).toEqual(['e1']);
    expect(inbox.envelopes[0]!.from).toBe('ada');
    expect(inbox.envelopes[0]!.receivedAt).toBe(1000);
    const ack = await call('/inbox/ack', {
      token: grace,
      body: { ids: ['e1'] },
    });
    expect(((await ack.json()) as { acked: number }).acked).toBe(1);
    expect(
      (
        (await (await call('/inbox', { token: grace })).json()) as {
          envelopes: unknown[];
        }
      ).envelopes.length
    ).toBe(0);
  });
  test('unknown recipient → 422', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    const res = await call('/envelopes', {
      token: ada,
      body: draft('e1', 'nobody'),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      'unknown-recipient'
    );
  });
  test('board endpoints reject a missing/bad token', async () => {
    const { call } = setup();
    expect((await call('/inbox')).status).toBe(401);
    expect(
      (await call('/envelopes', { token: 'bad', body: draft('e', 'x') })).status
    ).toBe(401);
  });
  test('bad publish body → 400', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    expect(
      (await call('/envelopes', { token: ada, body: { nope: 1 } })).status
    ).toBe(400);
  });
});

describe('asks toggle', () => {
  test('a board with asks off leaves askable but stays in peers; turning them on brings it back', async () => {
    const { call } = setup();
    const reg = async (u: string) =>
      (
        (await (
          await call('/boards', { token: ADMIN, body: { username: u } })
        ).json()) as { token: string }
      ).token;
    const ada = await reg('ada');
    const grace = await reg('grace');
    expect(
      (
        await call('/boards/self/asks', {
          method: 'PUT',
          token: grace,
          body: { enabled: false },
        })
      ).status
    ).toBe(200);
    const list = async () =>
      (await (await call('/peers', { token: ada })).json()) as {
        peers: string[];
        askable: string[];
      };
    expect((await list()).askable.sort()).toEqual(['ada']);
    expect((await list()).peers.sort()).toEqual(['ada', 'grace']);
    await call('/boards/self/asks', {
      method: 'PUT',
      token: grace,
      body: { enabled: true },
    });
    expect((await list()).askable.sort()).toEqual(['ada', 'grace']);
  });
  test('asks toggle needs a board token and a boolean', async () => {
    const { call } = setup();
    expect(
      (
        await call('/boards/self/asks', {
          method: 'PUT',
          body: { enabled: false },
        })
      ).status
    ).toBe(401);
    const t = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    expect(
      (
        await call('/boards/self/asks', {
          method: 'PUT',
          token: t,
          body: { enabled: 'no' },
        })
      ).status
    ).toBe(400);
    expect(
      (await call('/boards/self/asks', { method: 'GET', token: t })).status
    ).toBe(405);
  });
});

type Call = ReturnType<typeof setup>['call'];

async function register(
  call: Call,
  token: string,
  username: string,
  org?: string
): Promise<string> {
  const res = await call('/boards', {
    token,
    body: org === undefined ? { username } : { username, org },
  });
  if (res.status !== 201)
    throw new Error(`register ${username}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

function mintOrg(store: SwitchboardStore): { id: string; token: string } {
  const { id } = store.orgs.create(1000);
  return { id, token: store.orgs.mintToken(id, 1000)! };
}

const answer = async (r: Promise<Response>) => {
  const res = await r;
  return { status: res.status, text: await res.text() };
};

describe('org tokens on the admin routes', () => {
  test("an org token cannot list, register, reissue or delete another org's board", async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const b = mintOrg(store);
    await register(call, a.token, 'ada');
    const bob = await register(call, b.token, 'bob');
    const listed = await call('/boards', { token: a.token });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      boards: [{ username: 'ada', createdAt: expect.any(Number) }],
    });
    expect(
      await answer(
        call('/boards', { token: a.token, body: { username: ' Bob ' } })
      )
    ).toEqual({ status: 409, text: '{"error":"username-taken"}' });
    expect(
      (await call('/boards/bob', { method: 'DELETE', token: a.token })).status
    ).toBe(404);
    expect((await call('/inbox', { token: bob })).status).toBe(200);
    expect(store.boardOrg('bob')).toBe(b.id);
  });

  test('an org token naming any other org is 403 org-mismatch on /boards and /invites', async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const b = mintOrg(store);
    for (const path of ['/boards', '/invites'])
      for (const org of [b.id, 'f'.repeat(32)])
        expect(
          await answer(
            call(path, { token: a.token, body: { username: 'cy', org } })
          )
        ).toEqual({ status: 403, text: '{"error":"org-mismatch"}' });
    expect(store.listBoards()).toEqual([]);
    expect(store.orgs.list().map(o => o.boards)).toEqual([0, 0]);
  });

  test("an org token's org field naming its own org is accepted", async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    await register(call, a.token, 'ada', a.id);
    expect(store.boardOrg('ada')).toBe(a.id);
    const inv = await call('/invites', {
      token: a.token,
      body: { username: 'grace', org: a.id },
    });
    expect(inv.status).toBe(201);
    const { code } = (await inv.json()) as { code: string };
    expect(store.redeemInvite(code, 'grace', 2000).ok).toBe(true);
    expect(store.boardOrg('grace')).toBe(a.id);
  });

  test("a 409 on another org's POST /boards and POST /invites leaves the first board's token and inbox intact", async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const b = mintOrg(store);
    const ada = await register(call, a.token, 'ada');
    const cy = await register(call, a.token, 'cy');
    expect(
      (await call('/envelopes', { token: cy, body: draft('e1', 'ada') })).status
    ).toBe(201);
    expect(
      await answer(
        call('/boards', { token: b.token, body: { username: ' Ada ' } })
      )
    ).toEqual({ status: 409, text: '{"error":"username-taken"}' });
    expect(
      await answer(
        call('/invites', { token: b.token, body: { username: 'ADA' } })
      )
    ).toEqual({ status: 409, text: '{"error":"username-taken"}' });
    const inbox = await call('/inbox', { token: ada });
    expect(inbox.status).toBe(200);
    const { envelopes } = (await inbox.json()) as {
      envelopes: Array<{ id: string; from: string }>;
    };
    expect(envelopes.map(e => [e.id, e.from])).toEqual([['e1', 'cy']]);
    expect(store.boardOrg('ada')).toBe(a.id);
  });

  test("an org token's POST /invites for a username another org holds is 409 username-taken", async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const b = mintOrg(store);
    await register(call, b.token, 'bob');
    const held = await call('/invites', {
      token: b.token,
      body: { username: 'cy' },
    });
    const { code } = (await held.json()) as { code: string };
    for (const username of ['Bob', 'cy'])
      expect(
        await answer(call('/invites', { token: a.token, body: { username } }))
      ).toEqual({ status: 409, text: '{"error":"username-taken"}' });
    expect(store.redeemInvite(code, 'cy', 2000).ok).toBe(true);
    expect(store.boardOrg('cy')).toBe(b.id);
  });
});

describe('the master on the admin routes', () => {
  test('the master lists every board with an org field', async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const b = mintOrg(store);
    await register(call, a.token, 'ada');
    await register(call, b.token, 'bob');
    expect(await (await call('/boards', { token: ADMIN })).json()).toEqual({
      boards: [
        { username: 'ada', createdAt: expect.any(Number), org: a.id },
        { username: 'bob', createdAt: expect.any(Number), org: b.id },
      ],
    });
  });

  test('the master with no org registers into the legacy org on a fresh relay', async () => {
    const { store, call } = setup();
    const res = await call('/boards', {
      token: ADMIN,
      body: { username: 'Ada' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['token', 'username']);
    expect(body.username).toBe('ada');
    const legacy = store.orgs.legacyId();
    expect(legacy).not.toBeNull();
    expect(store.boardOrg('ada')).toBe(legacy);
    expect(store.authBoard(body.token as string)).toBe('ada');
  });

  test('the master with no org after a non-legacy org exists, and no legacy org, is 400 name-an-org', async () => {
    const { store, call } = setup();
    store.orgs.create(1000);
    for (const path of ['/boards', '/invites'])
      expect(
        await answer(call(path, { token: ADMIN, body: { username: 'ada' } }))
      ).toEqual({ status: 400, text: '{"error":"name-an-org"}' });
    expect(store.orgs.legacyId()).toBeNull();
  });

  test("the master's POST /boards {username, org: <unknown>} is 404", async () => {
    const { store, call } = setup();
    for (const path of ['/boards', '/invites'])
      expect(
        (
          await call(path, {
            token: ADMIN,
            body: { username: 'ada', org: 'f'.repeat(32) },
          })
        ).status
      ).toBe(404);
    expect(store.listBoards()).toEqual([]);
    expect(store.orgs.list()).toEqual([]);
  });

  test('the master names an org and registers into it', async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    await register(call, ADMIN, 'ada', a.id);
    expect(store.boardOrg('ada')).toBe(a.id);
  });
});

async function quietly(run: () => Promise<void>): Promise<void> {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await run();
  } finally {
    warn.mockRestore();
  }
}

describe('/orgs', () => {
  test('POST /orgs is 409 rotate-master-first while the master matches the legacy stamp', () =>
    quietly(async () => {
      const { db, call } = setup();
      await register(call, ADMIN, 'ada');
      expect(
        await answer(call('/orgs', { method: 'POST', token: ADMIN }))
      ).toEqual({ status: 409, text: '{"error":"rotate-master-first"}' });
      const rotated = setup(db, 'rotated-master-0123456789abcdef0123');
      const res = await rotated.call('/orgs', {
        method: 'POST',
        token: 'rotated-master-0123456789abcdef0123',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; token: string };
      expect(Object.keys(body).sort()).toEqual(['id', 'token']);
      expect(body.id).toMatch(/^[0-9a-f]{32}$/);
      expect(body.token).toMatch(ORG_TOKEN_RE);
      expect(rotated.store.orgs.authOrg(body.token)).toBe(body.id);
    }));

  test('on a fresh relay, a master POST /invites {username} with no org, then POST /orgs, is 409 rotate-master-first', async () => {
    const { call } = setup();
    expect(
      (await call('/invites', { token: ADMIN, body: { username: 'ada' } }))
        .status
    ).toBe(201);
    expect(
      await answer(call('/orgs', { method: 'POST', token: ADMIN }))
    ).toEqual({ status: 409, text: '{"error":"rotate-master-first"}' });
  });

  for (const path of ['/boards', '/invites'])
    test(`a master POST ${path} with no org stamps the legacy master`, async () => {
      const { store, call } = setup();
      expect(store.orgs.legacyId()).toBeNull();
      expect(
        (await call(path, { token: ADMIN, body: { username: 'ada' } })).status
      ).toBe(201);
      expect(await store.orgs.masterGateClosed(ADMIN)).toBe(true);
    });

  test('the awaited backstop stamps before the gate', async () => {
    const { store, call } = setup();
    store.registerBoard('ada');
    expect(store.orgs.legacyId()).not.toBeNull();
    expect(await store.orgs.masterGateClosed(ADMIN)).toBe(false);
    expect(
      await answer(call('/orgs', { method: 'POST', token: ADMIN }))
    ).toEqual({ status: 409, text: '{"error":"rotate-master-first"}' });
  });

  test('after a master POST /invites with no org, one rotation lifts the gate', () =>
    quietly(async () => {
      const { db, call } = setup();
      await call('/invites', { token: ADMIN, body: { username: 'ada' } });
      const rotated = setup(db, 'another-master-0123456789abcdef0123');
      expect(
        (
          await rotated.call('/orgs', {
            method: 'POST',
            token: 'another-master-0123456789abcdef0123',
          })
        ).status
      ).toBe(201);
    }));

  test('a fresh relay with no legacy org lets the master make an org', async () => {
    const { store, call } = setup();
    expect((await call('/orgs', { method: 'POST', token: ADMIN })).status).toBe(
      201
    );
    expect(store.orgs.legacyId()).toBeNull();
  });

  test('POST /orgs/<unknown>/token is 404', async () => {
    const { call } = setup();
    expect(
      (
        await call(`/orgs/${'f'.repeat(32)}/token`, {
          method: 'POST',
          token: ADMIN,
        })
      ).status
    ).toBe(404);
  });

  test('GET /orgs returns {orgs: [{id, legacy, hasToken, boards, createdAt, tokenAt}]}', async () => {
    const { store, call } = setup();
    await register(call, ADMIN, 'ada');
    const legacy = store.orgs.legacyId()!;
    const a = mintOrg(store);
    const res = await call('/orgs', { token: ADMIN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgs: OrgRow[] };
    const byId = Object.fromEntries(body.orgs.map(o => [o.id, o]));
    expect(byId[legacy]).toEqual({
      id: legacy,
      legacy: true,
      hasToken: false,
      boards: 1,
      createdAt: expect.any(Number),
      tokenAt: null,
    });
    expect(byId[a.id]).toEqual({
      id: a.id,
      legacy: false,
      hasToken: true,
      boards: 0,
      createdAt: 1000,
      tokenAt: 1000,
    });
    expect(body.orgs.length).toBe(2);
  });

  test('POST /orgs/<id>/token rotates: the old org token is 401, boards are untouched', async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const ada = await register(call, a.token, 'ada');
    const res = await call(`/orgs/${a.id}/token`, {
      method: 'POST',
      token: ADMIN,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; token: string };
    expect(Object.keys(body).sort()).toEqual(['id', 'token']);
    expect(body.id).toBe(a.id);
    expect(body.token).toMatch(ORG_TOKEN_RE);
    expect((await call('/boards', { token: a.token })).status).toBe(401);
    const listed = (await (
      await call('/boards', { token: body.token })
    ).json()) as { boards: Array<{ username: string }> };
    expect(listed.boards.map(b => b.username)).toEqual(['ada']);
    expect((await call('/inbox', { token: ada })).status).toBe(200);
  });

  test('/orgs routes refuse org tokens and board tokens with 401', async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const ada = await register(call, a.token, 'ada');
    for (const token of [a.token, ada, undefined]) {
      expect((await call('/orgs', { token })).status).toBe(401);
      expect((await call('/orgs', { method: 'POST', token })).status).toBe(401);
      expect(
        (await call(`/orgs/${a.id}/token`, { method: 'POST', token })).status
      ).toBe(401);
    }
    expect(store.orgs.authOrg(a.token)).toBe(a.id);
    expect(store.orgs.list().length).toBe(1);
  });
});

describe('a rotated master and the legacy org token', () => {
  const B = 'rotated-master-b-0123456789abcdef0123';
  const C = 'rotated-master-c-0123456789abcdef0123';

  async function mintLegacy(call: Call, master: string, legacy: string) {
    const res = await call(`/orgs/${legacy}/token`, {
      method: 'POST',
      token: master,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  async function legacyRelay() {
    const first = setup();
    const ada = await register(first.call, ADMIN, 'ada');
    const legacy = first.store.orgs.legacyId()!;
    const old = await mintLegacy(first.call, ADMIN, legacy);
    expect((await first.call('/boards', { token: old })).status).toBe(200);
    return { db: first.db, ada, legacy, old };
  }

  test("a rotated master revokes the legacy org's token on first start", async () => {
    const { db, ada, legacy, old } = await legacyRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rotated = setup(db, B);
      expect((await rotated.call('/boards', { token: old })).status).toBe(401);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain(legacy);
      for (const secret of [old, ADMIN, B]) expect(line).not.toContain(secret);
      const fresh = await mintLegacy(rotated.call, B, legacy);
      expect((await rotated.call('/boards', { token: fresh })).status).toBe(
        200
      );
      expect((await rotated.call('/inbox', { token: ada })).status).toBe(200);
    } finally {
      warn.mockRestore();
    }
  });

  test('a legacy token minted on the first request after a rotated start survives the revoke', async () => {
    const { db, legacy, old } = await legacyRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rotated = setup(db, B);
      const fresh = await mintLegacy(rotated.call, B, legacy);
      expect((await rotated.call('/boards', { token: old })).status).toBe(401);
      expect((await rotated.call('/boards', { token: fresh })).status).toBe(
        200
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('the revoke runs once', async () => {
    const { db, legacy } = await legacyRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rotated = setup(db, B);
      const fresh = await mintLegacy(rotated.call, B, legacy);
      for (const master of [B, C]) {
        const restarted = setup(db, master);
        expect((await restarted.call('/boards', { token: fresh })).status).toBe(
          200
        );
      }
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('a revoke that fails answers org tokens and /orgs with 503 relay-not-ready until a start whose revoke succeeds', async () => {
    const { db, ada, legacy, old } = await legacyRelay();
    const other = mintOrg(new SwitchboardStore(db));
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const broken = setup(db, B, store => {
        store.orgs.retireLegacyToken = () =>
          Promise.reject(new Error('disk I/O error'));
      });
      const notReady = { status: 503, text: '{"error":"relay-not-ready"}' };
      for (const token of [old, other.token]) {
        expect(await answer(broken.call('/boards', { token }))).toEqual(
          notReady
        );
        expect(
          await answer(
            broken.call('/invites', { token, body: { username: 'cy' } })
          )
        ).toEqual(notReady);
        expect(
          await answer(broken.call('/boards/ada', { method: 'DELETE', token }))
        ).toEqual(notReady);
      }
      expect(await answer(broken.call('/orgs', { token: B }))).toEqual(
        notReady
      );
      expect(
        await answer(
          broken.call(`/orgs/${legacy}/token`, { method: 'POST', token: B })
        )
      ).toEqual(notReady);
      expect((await broken.call('/boards', { token: B })).status).toBe(200);
      expect((await broken.call('/boards', { token: ada })).status).toBe(401);
      expect((await broken.call('/inbox', { token: ada })).status).toBe(200);
      expect(
        await answer(
          broken.call('/invites/redeem', {
            body: { code: 'any-code', username: 'eve' },
          })
        )
      ).toEqual(notReady);
      expect(error).toHaveBeenCalledTimes(1);
      const logged = error.mock.calls[0]!.map(String).join(' ');
      for (const secret of [old, other.token, ADMIN, B])
        expect(logged).not.toContain(secret);

      const healed = setup(db, B);
      expect((await healed.call('/boards', { token: old })).status).toBe(401);
      expect(
        (await healed.call('/boards', { token: other.token })).status
      ).toBe(200);
      await mintLegacy(healed.call, B, legacy);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  test('the revoke warns with the id it cleared and leaves no promise unhandled when a later store read throws', async () => {
    const { db, legacy, old } = await legacyRelay();
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rotated = setup(db, B, store => {
        store.orgs.legacyId = () => {
          throw new Error('SQLITE_BUSY');
        };
      });
      const retired = () =>
        db
          .query<unknown, []>(
            `SELECT 1 FROM relay_meta WHERE key = 'legacy_token_retired'`
          )
          .get() !== null;
      for (let i = 0; i < 400 && !retired(); i++) await Bun.sleep(5);
      expect(retired()).toBe(true);
      await Bun.sleep(20);
      expect(unhandled).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(legacy);
      expect((await rotated.call('/boards', { token: old })).status).toBe(401);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      warn.mockRestore();
      error.mockRestore();
    }
  });

  test('after the revoke, the old master set back cannot mint an org token, and the new master still can', async () => {
    const { db, legacy } = await legacyRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rotated = setup(db, B);
      const fresh = await mintLegacy(rotated.call, B, legacy);
      const back = setup(db, ADMIN);
      expect(
        await answer(
          back.call(`/orgs/${legacy}/token`, { method: 'POST', token: ADMIN })
        )
      ).toEqual({ status: 409, text: '{"error":"rotate-master-first"}' });
      expect((await back.call('/boards', { token: fresh })).status).toBe(200);
      const again = setup(db, B);
      await mintLegacy(again.call, B, legacy);
    } finally {
      warn.mockRestore();
    }
  });

  async function inviteRelay() {
    const first = setup();
    const ada = await register(first.call, ADMIN, 'ada');
    const invite = async (username: string) => {
      const res = await first.call('/invites', {
        token: ADMIN,
        body: { username },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { code: string }).code;
    };
    const open = await invite('eve');
    const used = await invite('grace');
    const redeemed = await first.call('/invites/redeem', {
      body: { code: used, username: 'grace' },
    });
    expect(redeemed.status).toBe(200);
    const grace = ((await redeemed.json()) as { token: string }).token;
    return { db: first.db, ada, grace, open };
  }
  const unknownInvite = {
    status: 404,
    text: 'invite not recognized. it may have been replaced; ask for a fresh one',
  };

  test("the revoke drops the legacy org's open invites and keeps boards from redeemed ones", async () => {
    const { db, ada, grace, open } = await inviteRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rotated = setup(db, B);
      expect((await rotated.call('/orgs', { token: B })).status).toBe(200);
      expect(
        await answer(
          rotated.call('/invites/redeem', {
            body: { code: open, username: 'eve' },
          })
        )
      ).toEqual(unknownInvite);
      expect(rotated.store.boardOrg('eve')).toBeNull();
      expect(rotated.store.listBoards().map(b => b.username)).toEqual([
        'ada',
        'grace',
      ]);
      for (const token of [ada, grace])
        expect((await rotated.call('/inbox', { token })).status).toBe(200);
    } finally {
      warn.mockRestore();
    }
  });

  test('a redeem sent as the first request after a rotated start waits for the revoke', async () => {
    const { db, open } = await inviteRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rotated = setup(db, B);
      expect(
        await answer(
          rotated.call('/invites/redeem', {
            body: { code: open, username: 'eve' },
          })
        )
      ).toEqual(unknownInvite);
      expect(rotated.store.boardOrg('eve')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  test('a restart with the same master keeps the legacy token', async () => {
    const { db, old } = await legacyRelay();
    const restarted = setup(db, ADMIN);
    expect((await restarted.call('/boards', { token: old })).status).toBe(200);
  });

  test('a fresh relay with no stamp never revokes', async () => {
    const { db, store } = setup();
    store.registerBoard('ada');
    const legacy = store.orgs.legacyId()!;
    const token = store.orgs.mintToken(legacy, 1000)!;
    expect(await store.orgs.masterGateClosed(ADMIN)).toBe(false);
    const rotated = setup(db, B);
    expect((await rotated.call('/boards', { token })).status).toBe(200);
  });

  test("a non-legacy org's token survives a later rotation", async () => {
    const { db } = await legacyRelay();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const lifted = setup(db, B);
      const res = await lifted.call('/orgs', { method: 'POST', token: B });
      expect(res.status).toBe(201);
      const org = (await res.json()) as { id: string; token: string };
      const bob = await register(lifted.call, org.token, 'bob');
      const again = setup(db, C);
      const listed = await again.call('/boards', { token: org.token });
      expect(listed.status).toBe(200);
      expect(
        (
          (await listed.json()) as { boards: Array<{ username: string }> }
        ).boards.map(b => b.username)
      ).toEqual(['bob']);
      expect((await again.call('/inbox', { token: bob })).status).toBe(200);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('tokens on the wrong routes', () => {
  test('the master on /peers is 401', async () => {
    const { call } = setup();
    await register(call, ADMIN, 'ada');
    expect((await call('/peers', { token: ADMIN })).status).toBe(401);
    expect((await call('/inbox', { token: ADMIN })).status).toBe(401);
  });

  test('a board token on /boards and an org token on /peers are 401', async () => {
    const { store, call } = setup();
    const a = mintOrg(store);
    const ada = await register(call, a.token, 'ada');
    expect((await call('/boards', { token: ada })).status).toBe(401);
    expect(
      (await call('/boards', { token: ada, body: { username: 'ada' } })).status
    ).toBe(401);
    expect(
      (await call('/boards/ada', { method: 'DELETE', token: ada })).status
    ).toBe(401);
    expect(
      (await call('/invites', { token: ada, body: { username: 'x' } })).status
    ).toBe(401);
    expect((await call('/peers', { token: a.token })).status).toBe(401);
    expect((await call('/inbox', { token: a.token })).status).toBe(401);
    expect(
      (await call('/envelopes', { token: a.token, body: draft('e1', 'ada') }))
        .status
    ).toBe(401);
  });
});

describe('board routes stay inside the org', () => {
  async function twoOrgs() {
    const relay = setup();
    const a = mintOrg(relay.store);
    const b = mintOrg(relay.store);
    return {
      ...relay,
      ada: await register(relay.call, a.token, 'ada'),
      grace: await register(relay.call, a.token, 'grace'),
      linus: await register(relay.call, b.token, 'linus'),
    };
  }

  test("/peers lists only the caller's org", async () => {
    const { call, ada, linus } = await twoOrgs();
    expect(await (await call('/peers', { token: ada })).json()).toEqual({
      peers: ['ada', 'grace'],
      askable: ['ada', 'grace'],
    });
    expect(await (await call('/peers', { token: linus })).json()).toEqual({
      peers: ['linus'],
      askable: ['linus'],
    });
  });

  test("/envelopes to * reaches only the caller's org; a direct send to another org is 422 unknown-recipient", async () => {
    const { call, ada, grace, linus } = await twoOrgs();
    const res = await call('/envelopes', {
      token: ada,
      body: draft('e1', '*'),
    });
    expect(await res.json()).toEqual({ ok: true, delivered: 1 });
    const inbox = async (token: string) =>
      (
        (await (await call('/inbox', { token })).json()) as {
          envelopes: unknown[];
        }
      ).envelopes.length;
    expect(await inbox(grace)).toBe(1);
    expect(await inbox(linus)).toBe(0);
    expect(
      await answer(
        call('/envelopes', { token: ada, body: draft('e2', 'linus') })
      )
    ).toEqual({ status: 422, text: '{"error":"unknown-recipient"}' });
    expect(await inbox(linus)).toBe(0);
  });

  test("/support/messages to another org is 422; /support/host/<other org's user> reads {accepting:false,lastSeenAt:null}", async () => {
    const { call, ada, linus } = await twoOrgs();
    expect(
      (
        await call('/support/host', {
          method: 'PUT',
          token: linus,
          body: { accepting: true, machine: 'mac-1' },
        })
      ).status
    ).toBe(200);
    expect(
      await (await call('/support/host/linus', { token: ada })).json()
    ).toEqual({ accepting: false, lastSeenAt: null });
    expect(
      await (await call('/support/host/linus', { token: linus })).json()
    ).toEqual({ accepting: true, lastSeenAt: 1000 });
    const support = {
      id: 'r1',
      to: 'linus',
      kind: 'request',
      sentAt: 1,
      body: '{}',
      mac: 'ab12',
    };
    expect(
      await answer(call('/support/messages', { token: ada, body: support }))
    ).toEqual({ status: 422, text: '{"error":"unknown-recipient"}' });
  });
});

describe("today's wire", () => {
  test("today's request bodies get today's response shapes", async () => {
    const keys = async (r: Promise<Response>, status: number) => {
      const res = await r;
      expect(res.status).toBe(status);
      return Object.keys((await res.json()) as object).sort();
    };
    const { store, call } = setup();
    // The master, no org field anywhere: today's rt.
    const reg = call('/boards', { token: ADMIN, body: { username: 'ada' } });
    expect(await keys(reg, 201)).toEqual(['token', 'username']);
    const grace = await register(call, ADMIN, 'grace');
    const ada = await register(call, ADMIN, 'ada');
    const boards = (await (await call('/boards', { token: ADMIN })).json()) as {
      boards: object[];
    };
    for (const b of boards.boards)
      expect(Object.keys(b).sort()).toEqual(['createdAt', 'org', 'username']);
    const inv = await call('/invites', {
      token: ADMIN,
      body: { username: 'linus' },
    });
    expect(inv.status).toBe(201);
    const invite = (await inv.json()) as Record<string, unknown>;
    expect(Object.keys(invite).sort()).toEqual([
      'code',
      'expiresAt',
      'username',
    ]);
    expect(
      await keys(
        call('/invites/redeem', {
          body: { code: invite.code, username: 'linus' },
        }),
        200
      )
    ).toEqual(['token', 'username']);
    expect(await keys(call('/peers', { token: ada }), 200)).toEqual([
      'askable',
      'peers',
    ]);
    expect(
      await (
        await call('/envelopes', { token: ada, body: draft('e1', 'grace') })
      ).json()
    ).toEqual({ ok: true, delivered: 1 });
    const support = {
      id: 'r1',
      to: 'grace',
      kind: 'request',
      sentAt: 1,
      body: '{}',
      mac: 'ab12',
    };
    expect(
      await (
        await call('/support/messages', { token: ada, body: support })
      ).json()
    ).toEqual({ ok: true });
    expect(
      await (await call('/support/host/grace', { token: ada })).json()
    ).toEqual({ accepting: false, lastSeenAt: null });
    expect(
      await (
        await call('/boards/linus', { method: 'DELETE', token: ADMIN })
      ).json()
    ).toEqual({ ok: true });
    expect((await call('/inbox', { token: grace })).status).toBe(200);

    // An org token, no org field: the same shapes, with no org field added.
    const a = mintOrg(store);
    expect(
      await keys(
        call('/boards', { token: a.token, body: { username: 'cy' } }),
        201
      )
    ).toEqual(['token', 'username']);
    expect(await (await call('/boards', { token: a.token })).json()).toEqual({
      boards: [{ username: 'cy', createdAt: expect.any(Number) }],
    });
    expect(
      await keys(
        call('/invites', { token: a.token, body: { username: 'dee' } }),
        201
      )
    ).toEqual(['code', 'expiresAt', 'username']);
    expect(
      await (
        await call('/boards/cy', { method: 'DELETE', token: a.token })
      ).json()
    ).toEqual({ ok: true });
  });

  test('masterTokenProblem refuses sbo_ and warns under 32 characters', () => {
    expect(masterTokenProblem(`sbo_${'a'.repeat(64)}`)?.refuse).toBe(true);
    expect(masterTokenProblem('sbo_short')?.refuse).toBe(true);
    const short = masterTokenProblem('admin-secret');
    expect(short?.refuse).toBe(false);
    for (const words of ['rotate', '32', 'openssl rand -hex 32'])
      expect(short?.message).toContain(words);
    expect(masterTokenProblem('x'.repeat(32))).toBeNull();
    expect(masterTokenProblem('0123456789abcdef'.repeat(4))).toBeNull();
  });
});
