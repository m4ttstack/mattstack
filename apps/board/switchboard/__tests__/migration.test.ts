import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { makeFetchHandler } from '../server.ts';
import {
  hashToken,
  INVITE_TTL_MS,
  sweepNullOrgs,
  SwitchboardStore,
} from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';
import { TelemetryStore } from '../telemetry.ts';

// The relay's schema before orgs, copied verbatim from store.ts at 4bb7f8907f.
const PRE_CHANGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS boards (
      username TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS asks_off (username TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS envelopes (
      id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      from_user TEXT NOT NULL,
      to_field TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (id, recipient)
    )`,
  `CREATE TABLE IF NOT EXISTS invites (
      code_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_at INTEGER
    )`,
];

const ADA = 'a'.repeat(64);
const GRACE = 'b'.repeat(64);
const INVITE_CODE = 'c'.repeat(32);
const NOW = Date.now();

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function preChangeDb(): { path: string; db: Database } {
  const dir = mkdtempSync(join(tmpdir(), 'sb-migration-'));
  dirs.push(dir);
  const path = join(dir, 'switchboard.sqlite');
  const db = new Database(path);
  for (const sql of PRE_CHANGE_SCHEMA) db.run(sql);
  db.run(
    `INSERT INTO boards (username, token_hash, created_at) VALUES (?, ?, ?), (?, ?, ?)`,
    ['ada', hashToken(ADA), 1, 'grace', hashToken(GRACE), 2]
  );
  db.run(
    `INSERT INTO invites (code_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    [hashToken(INVITE_CODE), 'linus', NOW, NOW + INVITE_TTL_MS]
  );
  return { path, db };
}

function orgIds(db: Database): Array<string | null> {
  return db
    .query<{ org_id: string | null }, []>(
      `SELECT org_id FROM boards UNION ALL SELECT org_id FROM invites`
    )
    .all()
    .map(r => r.org_id);
}

describe('a pre-change database', () => {
  test('pre-change boards keep authenticating and land in one legacy org', () => {
    const { db } = preChangeDb();
    const store = new SwitchboardStore(db);
    expect(store.authBoard(ADA)).toBe('ada');
    expect(store.authBoard(GRACE)).toBe('grace');
    const legacy = store.orgs.legacyId();
    expect(legacy).toMatch(/^[0-9a-f]{32}$/);
    expect(orgIds(db)).toEqual([legacy, legacy, legacy]);
    expect(store.orgs.list()).toEqual([
      {
        id: legacy!,
        legacy: true,
        hasToken: false,
        boards: 2,
        createdAt: expect.any(Number),
        tokenAt: null,
      },
    ]);
    const redeemed = store.redeemInvite(INVITE_CODE, 'linus', NOW + 1);
    if (!redeemed.ok) throw new Error(`expected ok, got ${redeemed.error}`);
    expect(store.authBoard(redeemed.token)).toBe('linus');
  });

  test('the sweep is idempotent across reopenings', () => {
    const { path, db } = preChangeDb();
    const legacy = new SwitchboardStore(db).orgs.legacyId();
    db.close();
    for (let i = 0; i < 2; i++) {
      const again = new Database(path);
      const store = new SwitchboardStore(again);
      expect(store.orgs.legacyId()).toBe(legacy);
      expect(store.orgs.list().length).toBe(1);
      expect(orgIds(again)).toEqual([legacy, legacy, legacy]);
      expect(sweepNullOrgs(again, NOW)).toEqual({ moved: 0, skipped: 0 });
      expect(store.authBoard(ADA)).toBe('ada');
      expect(store.authBoard(GRACE)).toBe('grace');
      again.close();
    }
  });

  test('NULL rows beside a non-legacy org are left alone and fail closed', () => {
    const { path, db } = preChangeDb();
    new SwitchboardStore(db).orgs.create(NOW);
    const MALLORY = 'd'.repeat(64);
    db.run(
      `INSERT INTO boards (username, token_hash, created_at) VALUES (?, ?, ?)`,
      ['mallory', hashToken(MALLORY), 3]
    );
    db.close();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reopened = new Database(path);
      const store = new SwitchboardStore(reopened);
      expect(warn).toHaveBeenCalled();
      expect(store.authBoard(MALLORY)).toBeNull();
      expect(store.authBoard(ADA)).toBe('ada');
      expect(sweepNullOrgs(reopened, NOW)).toEqual({ moved: 0, skipped: 1 });
      const row = reopened
        .query<{ org_id: string | null }, [string]>(
          `SELECT org_id FROM boards WHERE username = ?`
        )
        .get('mallory');
      expect(row).toEqual({ org_id: null });
      reopened.close();
    } finally {
      warn.mockRestore();
    }
  });

  test('over a pre-change database, the handler keeps every board working', async () => {
    const MASTER = 'pre-change-master';
    const { db } = preChangeDb();
    const store = new SwitchboardStore(db);
    const handler = makeFetchHandler(
      store,
      MASTER,
      () => NOW,
      new TeamInviteStore(db),
      new TelemetryStore(db),
      null
    );
    const call = (path: string, token: string, body?: unknown) =>
      handler(
        new Request(`http://x${path}`, {
          method: body !== undefined ? 'POST' : 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        })
      );
    const boardsStillWork = async () => {
      for (const token of [ADA, GRACE])
        expect((await call('/inbox', token)).status).toBe(200);
    };
    const legacy = store.orgs.legacyId()!;

    for (const [token, peer] of [
      [ADA, 'grace'],
      [GRACE, 'ada'],
    ] as const) {
      const peers = (await (await call('/peers', token)).json()) as {
        peers: string[];
      };
      expect(peers.peers).toContain(peer);
    }

    const reg = await call('/boards', MASTER, { username: 'linus' });
    expect(reg.status).toBe(201);
    expect(store.boardOrg('linus')).toBe(legacy);
    await boardsStillWork();

    const minted = await call(`/orgs/${legacy}/token`, MASTER, {});
    expect(minted.status).toBe(200);
    const first = ((await minted.json()) as { token: string }).token;
    expect((await call('/boards', first)).status).toBe(200);
    await boardsStillWork();

    const rotated = await call(`/orgs/${legacy}/token`, MASTER, {});
    expect(rotated.status).toBe(200);
    const second = ((await rotated.json()) as { token: string }).token;
    expect((await call('/boards', first)).status).toBe(401);
    expect((await call('/boards', second)).status).toBe(200);
    await boardsStillWork();
  });
});
