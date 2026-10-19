import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { macLabel, TelemetryStore, type TelemetryPing } from '../telemetry.ts';

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
        label: 'alice',
        kind: 'rt',
        from: '2.0.0',
        to: '2.1.0',
        at: T0 + 3 * MIN,
      },
      {
        label: 'alice',
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
      notRun: ['alice'],
      tooOld: ['bob'],
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
    expect(snap.legacyDirs).toEqual([{ label: 'alice', dirs: ['.rt'] }]);
    expect(snap.orgLayouts).toContainEqual({
      org: 'acme',
      layout: 3,
      macs: ['alice', 'bob'],
    });
    expect(snap.orgLayouts).toContainEqual({
      org: 'zed',
      layout: null,
      macs: ['bob'],
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
    expect(macLabel(row({ usernames: ['a', 'b'] }))).toBe('a, b');
    expect(macLabel(row({ usernames: [], installId: 'iid' }))).toBe('iid');
  });
});
