import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { ORG_TOKEN_PREFIX, ORG_TOKEN_RE } from '../orgs.ts';
import { hashToken, SwitchboardStore } from '../store.ts';

function setup() {
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  return { db, orgs: store.orgs };
}

const stamp = (db: Database) =>
  db
    .query<{ value: string }, []>(
      `SELECT value FROM relay_meta WHERE key = 'legacy_master_hash'`
    )
    .get()?.value ?? null;

describe('org tokens', () => {
  test('mint returns an sbo_ token that authOrg maps back to the org', () => {
    const { orgs } = setup();
    const { id } = orgs.create(1000);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const token = orgs.mintToken(id, 2000)!;
    expect(token.startsWith(ORG_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(ORG_TOKEN_RE);
    expect(orgs.authOrg(token)).toBe(id);
    expect(orgs.authOrg(`sbo_${'0'.repeat(64)}`)).toBeNull();
    expect(orgs.list()).toEqual([
      {
        id,
        legacy: false,
        hasToken: true,
        boards: 0,
        createdAt: 1000,
        tokenAt: 2000,
      },
    ]);
  });

  test('mintToken again replaces the token, and the old one stops authenticating', () => {
    const { orgs } = setup();
    const { id } = orgs.create(1000);
    const first = orgs.mintToken(id, 2000)!;
    const second = orgs.mintToken(id, 3000)!;
    expect(second).not.toBe(first);
    expect(orgs.authOrg(first)).toBeNull();
    expect(orgs.authOrg(second)).toBe(id);
    expect(orgs.list()[0]!.tokenAt).toBe(3000);
  });

  test('mintToken on an unknown id returns null', () => {
    const { orgs } = setup();
    expect(orgs.mintToken('f'.repeat(32), 1000)).toBeNull();
    expect(orgs.exists('f'.repeat(32))).toBe(false);
  });
});

describe('the legacy org', () => {
  test('ensureLegacy creates one legacy org, then returns the same id', () => {
    const { orgs } = setup();
    expect(orgs.legacyId()).toBeNull();
    const first = orgs.ensureLegacy(1000);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(orgs.ensureLegacy(2000)).toBe(first);
    expect(orgs.legacyId()).toBe(first);
    expect(orgs.exists(first!)).toBe(true);
    expect(orgs.hasNonLegacy()).toBe(false);
    expect(orgs.list()).toEqual([
      {
        id: first!,
        legacy: true,
        hasToken: false,
        boards: 0,
        createdAt: 1000,
        tokenAt: null,
      },
    ]);
  });

  test('ensureLegacy returns null once a non-legacy org exists and no legacy org does', () => {
    const { orgs } = setup();
    orgs.create(1000);
    expect(orgs.hasNonLegacy()).toBe(true);
    expect(orgs.ensureLegacy(2000)).toBeNull();
    expect(orgs.legacyId()).toBeNull();
    expect(orgs.list().length).toBe(1);
  });
});

describe('the legacy master stamp', () => {
  test('masterGateClosed is true for the stamped master, false for any other, and false when nothing is stamped', async () => {
    const { orgs } = setup();
    orgs.ensureLegacy(1000);
    expect(await orgs.masterGateClosed('master-one')).toBe(false);
    await orgs.stampLegacyMaster('master-one');
    expect(await orgs.masterGateClosed('master-one')).toBe(true);
    expect(await orgs.masterGateClosed('master-two')).toBe(false);
  });

  test("the stamp is not the master's plain sha256", async () => {
    const { db, orgs } = setup();
    orgs.ensureLegacy(1000);
    await orgs.stampLegacyMaster('master-one');
    const stored = stamp(db)!;
    expect(stored).not.toBe(hashToken('master-one'));
    expect(stored).not.toContain('master-one');
    expect(stored.startsWith('$argon2id$')).toBe(true);
  });

  test('stampLegacyMaster does nothing without a legacy org, and never overwrites a stamp', async () => {
    const { db, orgs } = setup();
    await orgs.stampLegacyMaster('master-one');
    expect(stamp(db)).toBeNull();
    orgs.ensureLegacy(1000);
    await orgs.stampLegacyMaster('master-one');
    const first = stamp(db);
    await orgs.stampLegacyMaster('master-two');
    expect(stamp(db)).toBe(first);
    expect(await orgs.masterGateClosed('master-one')).toBe(true);
    expect(await orgs.masterGateClosed('master-two')).toBe(false);
  });
});

describe('retiring the legacy org token', () => {
  const retired = (db: Database) =>
    db
      .query<{ value: string }, []>(
        `SELECT value FROM relay_meta WHERE key = 'legacy_token_retired'`
      )
      .get()?.value ?? null;

  test("under another master, it clears only the legacy org's token, once, and records the time", async () => {
    const { db, orgs } = setup();
    const legacy = orgs.ensureLegacy(1000)!;
    await orgs.stampLegacyMaster('master-a');
    const old = orgs.mintToken(legacy, 2000)!;
    const { id: other } = orgs.create(3000);
    const otherToken = orgs.mintToken(other, 3000)!;

    expect(await orgs.retireLegacyToken('master-b', 5000)).toBe(true);
    expect(orgs.authOrg(old)).toBeNull();
    expect(orgs.authOrg(otherToken)).toBe(other);
    expect(retired(db)).toBe('5000');
    const rows = Object.fromEntries(orgs.list().map(o => [o.id, o]));
    expect(rows[legacy]).toMatchObject({ hasToken: false, tokenAt: null });
    expect(rows[other]).toMatchObject({ hasToken: true, tokenAt: 3000 });

    const fresh = orgs.mintToken(legacy, 6000)!;
    for (const master of ['master-b', 'master-c'])
      expect(await orgs.retireLegacyToken(master, 7000)).toBe(false);
    expect(orgs.authOrg(fresh)).toBe(legacy);
    expect(retired(db)).toBe('5000');
  });

  test('it does nothing with no stamp, or while the master matches the stamp', async () => {
    const { db, orgs } = setup();
    const legacy = orgs.ensureLegacy(1000)!;
    const token = orgs.mintToken(legacy, 2000)!;
    expect(await orgs.retireLegacyToken('master-b', 3000)).toBe(false);
    await orgs.stampLegacyMaster('master-a');
    expect(await orgs.retireLegacyToken('master-a', 4000)).toBe(false);
    expect(orgs.authOrg(token)).toBe(legacy);
    expect(retired(db)).toBeNull();
  });
});
