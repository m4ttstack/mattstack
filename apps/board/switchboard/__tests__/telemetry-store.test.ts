import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import {
  macLabel,
  parsePing,
  TelemetryStore,
  type TelemetryPing,
} from '../telemetry.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = 1_000_000_000_000;

function ping(over: Partial<TelemetryPing> = {}): TelemetryPing {
  return {
    installId: 'install-a',
    usernames: ['alice'],
    appVersion: '2.0.0',
    rtVersion: '2.0.0',
    pluginVersion: '0.30.0',
    flavor: 'prod',
    macosVersion: '15.1',
    migrationsRecorded: [],
    migrationsKnown: [],
    legacyDirs: [],
    orgs: [],
    packs: [],
    ...over,
  };
}

function setup() {
  return new TelemetryStore(new Database(':memory:'));
}

describe('TelemetryStore', () => {
  test('two pings from one install id keep one row with the latest fields', () => {
    const s = setup();
    s.record(ping({ macosVersion: '15.0' }), null, T0);
    s.record(ping({ macosVersion: '15.1' }), 'alice-gh', T0 + MIN);
    const { macs } = s.snapshot(T0 + MIN);
    expect(macs).toHaveLength(1);
    expect(macs[0]!.macosVersion).toBe('15.1');
    expect(macs[0]!.verifiedUsername).toBe('alice-gh');
    expect(macs[0]!.lastSeen).toBe(T0 + MIN);
  });

  test('a version change appends one updates entry; an unchanged ping appends none', () => {
    const s = setup();
    s.record(ping(), null, T0);
    s.record(ping(), null, T0 + MIN);
    expect(s.snapshot(T0 + MIN).updates).toEqual([]);
    s.record(ping({ appVersion: '2.1.0' }), null, T0 + 2 * MIN);
    s.record(
      ping({ appVersion: '2.1.0', rtVersion: '2.1.0' }),
      null,
      T0 + 3 * MIN
    );
    expect(s.snapshot(T0 + 3 * MIN).updates).toEqual([
      {
        label: 'alice (unverified)',
        kind: 'rt',
        from: '2.0.0',
        to: '2.1.0',
        at: T0 + 3 * MIN,
      },
      {
        label: 'alice (unverified)',
        kind: 'app',
        from: '2.0.0',
        to: '2.1.0',
        at: T0 + 2 * MIN,
      },
    ]);
  });

  test('running is true at +59 min and false at +61 min', () => {
    const s = setup();
    s.record(ping(), null, T0);
    expect(s.snapshot(T0 + 59 * MIN).macs[0]!.running).toBe(true);
    expect(s.snapshot(T0 + 61 * MIN).macs[0]!.running).toBe(false);
  });

  test('prune drops a row and its updates after 90 days, keeps them before', () => {
    const s = setup();
    s.record(ping(), null, T0);
    s.record(ping({ rtVersion: '2.1.0' }), null, T0 + MIN);
    s.prune(T0 + 89 * DAY);
    let snap = s.snapshot(T0 + 89 * DAY);
    expect(snap.macs).toHaveLength(1);
    expect(snap.updates).toHaveLength(1);
    s.prune(T0 + 91 * DAY);
    snap = s.snapshot(T0 + 91 * DAY);
    expect(snap.macs).toEqual([]);
    expect(snap.updates).toEqual([]);
  });

  test('a migration known but not recorded is notRun; one unknown to a Mac is tooOld', () => {
    const s = setup();
    s.record(
      ping({
        installId: 'a',
        usernames: ['alice'],
        migrationsKnown: ['m1', 'm2'],
        migrationsRecorded: ['m1'],
      }),
      null,
      T0
    );
    s.record(
      ping({
        installId: 'b',
        usernames: ['bob'],
        migrationsKnown: ['m1'],
        migrationsRecorded: ['m1'],
      }),
      null,
      T0
    );
    const { migrations } = s.snapshot(T0);
    expect(migrations.find(m => m.id === 'm1')).toEqual({
      id: 'm1',
      notRun: [],
      tooOld: [],
    });
    expect(migrations.find(m => m.id === 'm2')).toEqual({
      id: 'm2',
      notRun: ['alice (unverified)'],
      tooOld: ['bob (unverified)'],
    });
  });

  test('packs.oldestVersion picks 1.9.0 over 1.10.0 and ignores null versions', () => {
    const s = setup();
    s.record(
      ping({
        installId: 'a',
        packs: [
          { id: 'p', version: '1.10.0' },
          { id: 'q', version: null },
        ],
      }),
      null,
      T0
    );
    s.record(
      ping({
        installId: 'b',
        packs: [
          { id: 'p', version: '1.9.0' },
          { id: 'q', version: null },
          { id: 'r', version: null },
        ],
      }),
      null,
      T0
    );
    s.record(
      ping({ installId: 'c', packs: [{ id: 'p', version: null }] }),
      null,
      T0
    );
    const { packs } = s.snapshot(T0);
    expect(packs.find(p => p.id === 'p')).toEqual({
      id: 'p',
      oldestVersion: '1.9.0',
      macs: 3,
    });
    expect(packs.find(p => p.id === 'q')).toEqual({
      id: 'q',
      oldestVersion: null,
      macs: 2,
    });
  });

  test('versions counts macs per kind and version with the latest lastSeen', () => {
    const s = setup();
    s.record(
      ping({ installId: 'a', appVersion: '2.0.0', rtVersion: '2.0.0' }),
      null,
      T0
    );
    s.record(
      ping({ installId: 'b', appVersion: '2.0.0', rtVersion: '2.1.0' }),
      null,
      T0 + MIN
    );
    const { versions } = s.snapshot(T0 + MIN);
    expect(versions).toContainEqual({
      kind: 'app',
      version: '2.0.0',
      macs: 2,
      lastSeen: T0 + MIN,
    });
    expect(versions).toContainEqual({
      kind: 'rt',
      version: '2.0.0',
      macs: 1,
      lastSeen: T0,
    });
    expect(versions).toContainEqual({
      kind: 'rt',
      version: '2.1.0',
      macs: 1,
      lastSeen: T0 + MIN,
    });
  });

  test('legacyDirs lists macs that have any; orgLayouts groups macs by org and layout', () => {
    const s = setup();
    s.record(
      ping({
        installId: 'a',
        usernames: ['alice'],
        legacyDirs: ['.rt'],
        orgs: [{ org: 'acme', layout: 3 }],
      }),
      null,
      T0
    );
    s.record(
      ping({
        installId: 'b',
        usernames: ['bob'],
        orgs: [
          { org: 'acme', layout: 3 },
          { org: 'zed', layout: null },
        ],
      }),
      null,
      T0
    );
    const snap = s.snapshot(T0);
    expect(snap.legacyDirs).toEqual([
      { label: 'alice (unverified)', dirs: ['.rt'] },
    ]);
    expect(snap.orgLayouts).toContainEqual({
      org: 'acme',
      layout: 3,
      macs: ['alice (unverified)', 'bob (unverified)'],
    });
    expect(snap.orgLayouts).toContainEqual({
      org: 'zed',
      layout: null,
      macs: ['bob (unverified)'],
    });
  });

  test('macs are newest lastSeen first', () => {
    const s = setup();
    s.record(ping({ installId: 'old' }), null, T0);
    s.record(ping({ installId: 'new' }), null, T0 + MIN);
    expect(s.snapshot(T0 + MIN).macs.map(m => m.installId)).toEqual([
      'new',
      'old',
    ]);
  });
});

describe('macLabel', () => {
  const row = (over: Partial<Parameters<typeof macLabel>[0]>) => ({
    ...ping(),
    verifiedUsername: null,
    lastSeen: 0,
    running: false,
    ...over,
  });

  test('prefers the verified username, then usernames, then the install id', () => {
    expect(macLabel(row({ verifiedUsername: 'v' }))).toBe('v');
    expect(macLabel(row({ usernames: ['a', 'b'] }))).toBe('a, b (unverified)');
    expect(macLabel(row({ usernames: [], installId: 'iid' }))).toBe('iid');
  });
});

describe('TelemetryStore edge cases', () => {
  test('a first ping appends no update', () => {
    const s = setup();
    s.record(ping(), null, T0);
    expect(s.snapshot(T0).updates).toEqual([]);
  });

  test('a null new appVersion appends no update', () => {
    const s = setup();
    s.record(ping(), null, T0);
    s.record(ping({ appVersion: null }), null, T0 + MIN);
    expect(s.snapshot(T0 + MIN).updates).toEqual([]);
  });

  test('a pack listed twice by one Mac counts that Mac once', () => {
    const s = setup();
    s.record(
      ping({
        packs: [
          { id: 'p', version: '1.0.0' },
          { id: 'p', version: '1.2.0' },
        ],
      }),
      null,
      T0
    );
    expect(s.snapshot(T0).packs).toEqual([
      { id: 'p', oldestVersion: '1.0.0', macs: 1 },
    ]);
  });

  test('a malformed ping never lands, so snapshot keeps working', () => {
    const s = setup();
    s.record(ping(), null, T0);
    s.record({ installId: 'evil' } as unknown as TelemetryPing, null, T0);
    s.record(
      {
        ...ping({ installId: 'bad' }),
        rtVersion: 5,
      } as unknown as TelemetryPing,
      null,
      T0
    );
    expect(s.snapshot(T0).macs.map(m => m.installId)).toEqual(['install-a']);
  });

  test('extra keys never land in the stored row', () => {
    const s = setup();
    s.record({ ...ping(), hostname: 'secret' } as TelemetryPing, null, T0);
    expect(s.snapshot(T0).macs[0]).not.toHaveProperty('hostname');
  });

  test('snapshot stays fast with many migration ids', () => {
    const s = setup();
    const ids = Array.from({ length: 256 }, (_, i) => `migration-${i}`);
    for (let i = 0; i < 50; i++) {
      s.record(ping({ installId: `mac-${i}`, migrationsKnown: ids }), null, T0);
    }
    const start = performance.now();
    s.snapshot(T0);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('parsePing', () => {
  const raw = (over: Record<string, unknown> = {}): unknown => ({
    ...ping(),
    ...over,
  });

  test('accepts a valid ping and drops extra keys', () => {
    expect(parsePing(raw())).toEqual(ping());
    const parsed = parsePing(raw({ hostname: 'x', repos: ['y'] }));
    expect(parsed).toEqual(ping());
    expect(parsed).not.toHaveProperty('hostname');
    expect(parsed).not.toHaveProperty('repos');
  });

  test('accepts null for the nullable fields and nested entries', () => {
    expect(
      parsePing(
        raw({
          appVersion: null,
          pluginVersion: null,
          macosVersion: null,
          orgs: [{ org: 'acme', layout: null }],
          packs: [{ id: 'p', version: null }],
        })
      )
    ).not.toBeNull();
  });

  test('rejects non-objects and a missing or empty installId', () => {
    for (const bad of [null, undefined, 'x', 5, [], true]) {
      expect(parsePing(bad)).toBeNull();
    }
    expect(parsePing({ installId: 'evil' })).toBeNull();
    expect(parsePing(raw({ installId: '' }))).toBeNull();
    expect(parsePing(raw({ installId: 7 }))).toBeNull();
  });

  test('rejects every field of the wrong type without coercing', () => {
    const wrong: Record<string, unknown> = {
      usernames: 'alice',
      appVersion: 2,
      rtVersion: 5,
      pluginVersion: 1,
      flavor: 'staging',
      macosVersion: {},
      migrationsRecorded: [1],
      migrationsKnown: 'm1',
      legacyDirs: [null],
      orgs: [{ org: 1, layout: 3 }],
      packs: [{ id: 'p', version: 1 }],
    };
    for (const [key, value] of Object.entries(wrong)) {
      expect(parsePing(raw({ [key]: value }))).toBeNull();
    }
    expect(parsePing(raw({ orgs: [{ org: 'a', layout: '3' }] }))).toBeNull();
    expect(parsePing(raw({ orgs: ['acme'] }))).toBeNull();
    expect(parsePing(raw({ packs: [null] }))).toBeNull();
  });

  test('rejects a missing required field', () => {
    for (const key of Object.keys(ping()) as (keyof TelemetryPing)[]) {
      if (key === 'installId') continue;
      const rest: Record<string, unknown> = { ...ping() };
      delete rest[key];
      expect(parsePing(rest)).toBeNull();
    }
  });

  test('rejects arrays over 256 entries and strings over 128 chars', () => {
    const many = Array.from({ length: 257 }, (_, i) => `m${i}`);
    expect(parsePing(raw({ migrationsKnown: many }))).toBeNull();
    expect(
      parsePing(raw({ packs: many.map(id => ({ id, version: null })) }))
    ).toBeNull();
    expect(
      parsePing(raw({ migrationsKnown: many.slice(0, 256) }))
    ).not.toBeNull();
    expect(parsePing(raw({ rtVersion: 'x'.repeat(129) }))).toBeNull();
    expect(parsePing(raw({ installId: 'x'.repeat(129) }))).toBeNull();
    expect(parsePing(raw({ usernames: ['x'.repeat(129)] }))).toBeNull();
    expect(parsePing(raw({ rtVersion: 'x'.repeat(128) }))).not.toBeNull();
  });
});
