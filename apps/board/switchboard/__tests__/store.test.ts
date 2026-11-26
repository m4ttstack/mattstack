import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import type { DraftEnvelope } from '../../src/peer/envelope.ts';
import {
  ENVELOPE_TTL_MS,
  hashToken,
  SwitchboardStore,
  UsernameTakenError,
} from '../store.ts';

function makeStore(): SwitchboardStore {
  return new SwitchboardStore(new Database(':memory:'));
}
function draft(id: string, to: string): DraftEnvelope {
  return { id, to, type: 'review-state', sentAt: 1, payload: { k: id } };
}

describe('boards', () => {
  test('register mints a token that auths back to the canonical username', () => {
    const s = makeStore();
    const { token } = s.registerBoard(' Grace ');
    expect(s.authBoard(token)).toBe('grace');
    expect(s.authBoard('wrong')).toBeNull();
  });
  test('re-register rotates: old token dies, new token works', () => {
    const s = makeStore();
    const first = s.registerBoard('ada').token;
    const second = s.registerBoard('ada').token;
    expect(s.authBoard(first)).toBeNull();
    expect(s.authBoard(second)).toBe('ada');
  });
});

describe('publish/inbox/ack', () => {
  test('addressed publish lands only in the recipient inbox, stamped from+receivedAt', () => {
    const s = makeStore();
    s.registerBoard('ada');
    s.registerBoard('grace');
    const r = s.publish('ada', draft('e1', 'grace'), 500);
    expect(r).toEqual({ ok: true, delivered: 1 });
    const inbox = s.inbox('grace');
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.from).toBe('ada');
    expect(inbox[0]!.receivedAt).toBe(500);
    expect(s.inbox('ada').length).toBe(0);
  });
  test('unknown recipient is rejected', () => {
    const s = makeStore();
    s.registerBoard('ada');
    expect(s.publish('ada', draft('e1', 'nobody'), 1)).toEqual({
      ok: false,
      error: 'unknown-recipient',
    });
  });
  test('broadcast fans out to everyone except the sender', () => {
    const s = makeStore();
    for (const u of ['ada', 'grace', 'linus']) s.registerBoard(u);
    const r = s.publish('ada', draft('e1', '*'), 1);
    expect(r).toEqual({ ok: true, delivered: 2 });
    expect(s.inbox('grace').length).toBe(1);
    expect(s.inbox('ada').length).toBe(0);
  });
  test('duplicate id for the same recipient is idempotent (at-least-once upstream)', () => {
    const s = makeStore();
    s.registerBoard('ada');
    s.registerBoard('grace');
    s.publish('ada', draft('e1', 'grace'), 1);
    s.publish('ada', draft('e1', 'grace'), 2);
    expect(s.inbox('grace').length).toBe(1);
  });
  test('ack deletes only the named ids for that recipient', () => {
    const s = makeStore();
    s.registerBoard('ada');
    s.registerBoard('grace');
    s.publish('ada', draft('e1', 'grace'), 1);
    s.publish('ada', draft('e2', 'grace'), 2);
    expect(s.ack('grace', ['e1'])).toBe(1);
    expect(s.inbox('grace').map(e => e.id)).toEqual(['e2']);
  });
  test('inbox is oldest first by receivedAt', () => {
    const s = makeStore();
    s.registerBoard('ada');
    s.registerBoard('grace');
    s.publish('ada', draft('e2', 'grace'), 200);
    s.publish('ada', draft('e1', 'grace'), 100);
    expect(s.inbox('grace').map(e => e.id)).toEqual(['e1', 'e2']);
  });
});

describe('prune', () => {
  test('drops envelopes older than the ttl', () => {
    const s = makeStore();
    s.registerBoard('ada');
    s.registerBoard('grace');
    s.publish('ada', draft('old', 'grace'), 0);
    s.publish('ada', draft('new', 'grace'), ENVELOPE_TTL_MS);
    expect(s.prune(ENVELOPE_TTL_MS + 1)).toBe(1);
    expect(s.inbox('grace').map(e => e.id)).toEqual(['new']);
  });
});

describe('asks off', () => {
  test('deleteBoard clears the asks-off row, so a re-registered name is askable again', () => {
    const s = makeStore();
    s.registerBoard('ada');
    s.setAsksEnabled('ada', false);
    expect(s.listAskableUsernames()).toEqual([]);
    s.deleteBoard('ada');
    s.registerBoard('ada');
    expect(s.listAskableUsernames()).toEqual(['ada']);
  });
});

describe('orgs', () => {
  function twoOrgs() {
    const db = new Database(':memory:');
    const s = new SwitchboardStore(db);
    const a = s.orgs.create(1).id;
    const b = s.orgs.create(2).id;
    return { db, s, a, b };
  }
  const board = (db: Database, username: string) =>
    db
      .query<{ token_hash: string; org_id: string | null }, [string]>(
        `SELECT token_hash, org_id FROM boards WHERE username = ?`
      )
      .get(username);

  test('a username another org holds is refused, and the first board keeps its token', () => {
    const { s, a, b } = twoOrgs();
    const { token } = s.registerBoard('ada', a);
    expect(() => s.registerBoard(' Ada ', b)).toThrow(UsernameTakenError);
    expect(s.authBoard(token)).toBe('ada');
    expect(s.boardOrg('ada')).toBe(a);
  });

  test('an open invite in another org holds the username', () => {
    const { s, a, b } = twoOrgs();
    s.createInvite('ada', Date.now(), a);
    expect(() => s.registerBoard('ADA', b)).toThrow(UsernameTakenError);
    expect(s.boardOrg('ada')).toBeNull();
    s.createInvite('bob', 1000, a);
    expect(s.registerBoard('bob', b).username).toBe('bob');
    expect(s.boardOrg('bob')).toBe(b);
  });

  test("createInvite(X, orgB) throws UsernameTakenError when org A holds X through a board, and again through an open invite; A's invite stays redeemable", () => {
    const { s, a, b } = twoOrgs();
    const now = Date.now();
    s.registerBoard('ada', a);
    expect(() => s.createInvite(' Ada', now, b)).toThrow(UsernameTakenError);
    const inv = s.createInvite('grace', now, a);
    expect(() => s.createInvite('Grace', now, b)).toThrow(UsernameTakenError);
    const r = s.redeemInvite(inv.code, 'grace', now + 1);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(s.authBoard(r.token)).toBe('grace');
    expect(s.boardOrg('grace')).toBe(a);
  });

  test('a NULL-org board row (the rollback case) holds its username: register and invite are refused for every org, and the row is unchanged', () => {
    const db = new Database(':memory:');
    const s = new SwitchboardStore(db);
    s.orgs.ensureLegacy(1);
    const b = s.orgs.create(2).id;
    db.run(
      `INSERT INTO boards (username, token_hash, created_at) VALUES (?, ?, ?)`,
      ['eve', hashToken('eve-token'), 3]
    );
    const now = Date.now();
    expect(() => s.registerBoard('eve')).toThrow(UsernameTakenError);
    expect(() => s.registerBoard('Eve', b)).toThrow(UsernameTakenError);
    expect(() => s.createInvite('eve', now)).toThrow(UsernameTakenError);
    expect(() => s.createInvite('eve', now, b)).toThrow(UsernameTakenError);
    expect(board(db, 'eve')).toEqual({
      token_hash: hashToken('eve-token'),
      org_id: null,
    });
  });

  test('a NULL-org open invite holds its username: register and invite are refused for an org, and the row is unchanged', () => {
    const { db, s, a } = twoOrgs();
    const now = Date.now();
    db.run(
      `INSERT INTO invites (code_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      [hashToken('eve-code'), 'eve', now, now + 60_000]
    );
    const invite = () =>
      db
        .query<unknown, [string]>(`SELECT * FROM invites WHERE username = ?`)
        .all('eve');
    const before = invite();
    expect(before).toEqual([
      {
        code_hash: hashToken('eve-code'),
        username: 'eve',
        created_at: now,
        expires_at: now + 60_000,
        redeemed_at: null,
        org_id: null,
      },
    ]);
    expect(() => s.registerBoard('eve', a)).toThrow(UsernameTakenError);
    expect(() => s.createInvite('Eve', now, a)).toThrow(UsernameTakenError);
    expect(invite()).toEqual(before);
    expect(s.boardOrg('eve')).toBeNull();
  });

  test('re-register in the same org still reissues', () => {
    const { s, a } = twoOrgs();
    const first = s.registerBoard('ada', a).token;
    const second = s.registerBoard(' ADA ', a).token;
    expect(s.authBoard(first)).toBeNull();
    expect(s.authBoard(second)).toBe('ada');
    expect(s.boardOrg('ada')).toBe(a);
  });

  test("publish to * reaches only the sender's org", () => {
    const { s, a, b } = twoOrgs();
    s.registerBoard('ada', a);
    s.registerBoard('grace', a);
    s.registerBoard('linus', b);
    expect(s.recipients('ada', '*')).toEqual(['grace']);
    expect(s.publish('ada', draft('e1', '*'), 1)).toEqual({
      ok: true,
      delivered: 1,
    });
    expect(s.inbox('grace').length).toBe(1);
    expect(s.inbox('linus').length).toBe(0);
    expect(s.inbox('ada').length).toBe(0);
  });

  test("a direct publish to another org's board is unknown-recipient", () => {
    const { s, a, b } = twoOrgs();
    s.registerBoard('ada', a);
    s.registerBoard('linus', b);
    expect(s.recipients('ada', 'linus')).toEqual([]);
    expect(s.publish('ada', draft('e1', 'linus'), 1)).toEqual({
      ok: false,
      error: 'unknown-recipient',
    });
    expect(s.inbox('linus').length).toBe(0);
  });

  test('listBoards(org) and listAskableUsernames(org) list only that org', () => {
    const { s, a, b } = twoOrgs();
    s.registerBoard('ada', a);
    s.registerBoard('grace', a);
    s.registerBoard('linus', b);
    s.setAsksEnabled('grace', false);
    expect(s.listBoards(a).map(r => [r.username, r.org])).toEqual([
      ['ada', a],
      ['grace', a],
    ]);
    expect(s.listBoards().map(r => [r.username, r.org])).toEqual([
      ['ada', a],
      ['grace', a],
      ['linus', b],
    ]);
    expect(s.listAskableUsernames(a)).toEqual(['ada']);
    expect(s.listAskableUsernames(b)).toEqual(['linus']);
    expect(s.listAskableUsernames()).toEqual(['ada', 'linus']);
  });

  test("deleteBoard with another org's id returns false and keeps the board", () => {
    const { s, a, b } = twoOrgs();
    const { token } = s.registerBoard('linus', b);
    expect(s.deleteBoard('linus', a)).toBe(false);
    expect(s.authBoard(token)).toBe('linus');
    expect(s.deleteBoard('Linus', b)).toBe(true);
    expect(s.authBoard(token)).toBeNull();
  });

  test('registerBoard with no org after a non-legacy org exists throws name-an-org', () => {
    const { s } = twoOrgs();
    expect(() => s.registerBoard('ada')).toThrow('name-an-org');
    expect(() => s.createInvite('ada')).toThrow('name-an-org');
    expect(s.orgs.legacyId()).toBeNull();
    expect(s.listBoards()).toEqual([]);
  });
});
