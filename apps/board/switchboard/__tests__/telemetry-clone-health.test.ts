import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { renderTelemetryPage } from '../telemetry-page.ts';
import {
  cloneFlags,
  parsePing,
  TelemetryStore,
  type CloneHealth,
  type TelemetryPing,
} from '../telemetry.ts';

const HOUR = 60 * 60_000;
const T0 = Date.parse('2026-11-18T12:00:00Z');

const CLONE: CloneHealth = {
  onDataBranch: true,
  behind: 0,
  ahead: 0,
  lastPullAt: new Date(T0 - HOUR).toISOString(),
  pull: 'ok',
  canPublish: false,
  dirtyCount: 0,
  dirtySince: null,
  conflicted: false,
  layoutHold: false,
};

function ping(over: Partial<TelemetryPing> = {}): TelemetryPing {
  return {
    installId: 'install-a',
    usernames: ['dev1'],
    appVersion: '2.32.0',
    rtVersion: '2.32.0',
    pluginVersion: '0.32.77',
    flavor: 'prod',
    macosVersion: '26.2',
    migrationsRecorded: [],
    migrationsKnown: [],
    legacyDirs: [],
    orgs: [{ org: 'acme', layout: 5, clone: CLONE }],
    packs: [
      {
        id: 'web@acme',
        version: '0.11.67',
        staleCount: 1,
      },
    ],
    appUpdate: null,
    ...over,
  };
}

/** As a Mac older than this sends it. */
const OLD_CLONE = {
  branch: 'SECRET-branch',
  dataBranch: 'SECRET-data',
  head: 'SECRETaaaa',
  upstream: 'SECRETbbbb',
  behind: 0,
  ahead: 0,
  lastPullAt: CLONE.lastPullAt,
  pull: 'ok',
  canPublish: false,
  dirtyCount: 2,
  dirty: [
    { path: 'SECRET/one.md', status: 'M' },
    { path: `SECRET/${'a/'.repeat(80)}two.md`, status: '??' },
  ],
  dirtySince: null,
  conflicted: false,
  layoutHold: false,
};
const OLD_STALE = [
  { skill: 'SECRET-work', causes: ['source'] },
  { skill: 'SECRET-ship', causes: ['version'] },
];
const OLD_PING = {
  ...ping(),
  orgs: [{ org: 'acme', layout: 5, clone: OLD_CLONE }],
  packs: [{ id: 'web@acme', version: '0.11.67', stale: OLD_STALE }],
};

const store = () => new TelemetryStore(new Database(':memory:'));

describe('parsePing clone health', () => {
  test('keeps a clone block and a pack stale count', () => {
    const parsed = parsePing(JSON.parse(JSON.stringify(ping())));
    expect(parsed?.orgs[0]?.clone).toEqual(CLONE);
    expect(parsed?.packs[0]).toEqual({
      id: 'web@acme',
      version: '0.11.67',
      staleCount: 1,
    });
  });

  test('a Mac that still sends names has them dropped and the counts kept', () => {
    const parsed = parsePing(OLD_PING);
    expect(parsed?.orgs[0]?.clone).toEqual({
      ...CLONE,
      onDataBranch: false,
      dirtyCount: 2,
    });
    expect(parsed?.packs[0]).toEqual({
      id: 'web@acme',
      version: '0.11.67',
      staleCount: 2,
    });
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
  });

  test('a clone that does not say reads as unknown', () => {
    const clone = (over: object) =>
      parsePing({
        ...ping(),
        orgs: [{ org: 'acme', layout: 5, clone: { ...CLONE, ...over } }],
      })?.orgs[0]?.clone?.onDataBranch;
    expect(clone({ onDataBranch: undefined })).toBeNull();
    expect(clone({ onDataBranch: null })).toBeNull();
    expect(
      clone({ onDataBranch: undefined, branch: 'a', dataBranch: 'a' })
    ).toBe(true);
    expect(
      clone({ onDataBranch: undefined, branch: null, dataBranch: 'a' })
    ).toBe(false);
    expect(clone({ onDataBranch: 'SECRET' })).toBeNull();
  });

  test('a malformed clone or stale list reads as null and keeps the ping', () => {
    const parsed = parsePing(
      ping({
        orgs: [{ org: 'acme', layout: 5, clone: { pull: 42 } as never }],
        packs: [{ id: 'web@acme', version: null, staleCount: 'nope' as never }],
      })
    );
    expect(parsed?.orgs[0]?.clone).toBeNull();
    expect(parsed?.packs[0]?.staleCount).toBeNull();
  });

  test('a ping from a Mac older than the fields has no clone or stale', () => {
    const parsed = parsePing(
      ping({
        orgs: [{ org: 'acme', layout: 5 }],
        packs: [{ id: 'web@acme', version: null }],
      })
    );
    expect(parsed?.orgs[0]).toEqual({ org: 'acme', layout: 5 });
    expect(parsed?.packs[0]).toEqual({ id: 'web@acme', version: null });
  });
});

describe('cloneFlags', () => {
  test('a healthy clone has no flags', () => {
    expect(cloneFlags(CLONE, T0)).toEqual([]);
  });

  test('names each thing wrong with a clone', () => {
    expect(
      cloneFlags(
        {
          ...CLONE,
          lastPullAt: new Date(T0 - 7 * HOUR).toISOString(),
          pull: 'local-changes',
          behind: 4,
          dirtyCount: 3,
          conflicted: true,
          layoutHold: true,
        },
        T0
      )
    ).toEqual([
      'no good pull in 6h+',
      'last pull: local-changes',
      'behind origin by 4',
      '3 uncommitted files on a Mac that cannot publish them',
      'rebase stopped mid-way',
      'pull held for a layout this app cannot read',
    ]);
  });

  test('dirty files on a Mac that can publish are not flagged', () => {
    expect(
      cloneFlags({ ...CLONE, canPublish: true, dirtyCount: 2 }, T0)
    ).toEqual([]);
  });
});

describe('clone timeline', () => {
  test('records a state change, and not a pull that only moved the pull time', () => {
    const s = store();
    s.record(ping(), null, T0);
    s.record(
      ping({
        orgs: [
          {
            org: 'acme',
            layout: 5,
            clone: { ...CLONE, lastPullAt: new Date(T0).toISOString() },
          },
        ],
      }),
      null,
      T0 + HOUR
    );
    s.record(
      ping({
        orgs: [
          {
            org: 'acme',
            layout: 5,
            clone: {
              ...CLONE,
              pull: 'local-changes',
              behind: 2,
              dirtyCount: 1,
            },
          },
        ],
      }),
      'dev1',
      T0 + 2 * HOUR
    );
    const report = s.cloneReport(T0 + 2 * HOUR, 'dev1');
    expect(report.macs).toHaveLength(1);
    expect(report.macs[0]!.label).toBe('dev1');
    expect(report.macs[0]!.orgs[0]!.flags).toContain('behind origin by 2');
    expect(report.events.map(e => e.at)).toEqual([T0, T0 + 2 * HOUR]);
    expect(report.events[1]!.state.clones.acme?.pull).toBe('local-changes');
    expect(report.events[1]!.state.stale['web@acme']).toBe(1);
  });

  test('a report for one person leaves the others out', () => {
    const s = store();
    s.record(ping(), 'dev1', T0);
    s.record(ping({ installId: 'install-b', usernames: ['dev2'] }), 'dev2', T0);
    expect(s.cloneReport(T0, 'dev2').macs.map(m => m.label)).toEqual(['dev2']);
    expect(s.cloneReport(T0).macs).toHaveLength(2);
  });
});

describe('clone health on the telemetry page', () => {
  test('the snapshot lists only flagged clones, with their reasons and stale skill count', () => {
    const s = store();
    s.record(ping(), 'dev1', T0);
    s.record(
      ping({
        installId: 'install-b',
        usernames: ['dev2'],
        orgs: [
          {
            org: 'acme',
            layout: 5,
            clone: { ...CLONE, behind: 3, pull: 'fetch-auth' },
          },
        ],
      }),
      'dev2',
      T0
    );
    expect(s.snapshot(T0).clones).toEqual([
      {
        label: 'dev2',
        org: 'acme',
        flags: ['last pull: fetch-auth', 'behind origin by 3'],
        lastPullAt: CLONE.lastPullAt,
        stale: 1,
      },
    ]);
  });

  test('a clone whose pull time is not a date still renders the page', () => {
    const s = store();
    s.record(
      ping({
        orgs: [
          {
            org: 'acme',
            layout: 5,
            clone: { ...CLONE, lastPullAt: 'not-a-date' },
          },
        ],
      }),
      null,
      T0
    );
    const html = renderTelemetryPage(s.snapshot(T0));
    expect(html).toContain('no good pull in 6h+');
  });

  test('the page shows a Clone health panel', () => {
    const s = store();
    s.record(
      ping({
        orgs: [{ org: 'acme', layout: 5, clone: { ...CLONE, behind: 2 } }],
      }),
      'dev1',
      T0
    );
    const html = renderTelemetryPage(s.snapshot(T0));
    expect(html).toContain('Clone health');
    expect(html).toContain('behind origin by 2');
  });
});

describe('rows kept by a relay older than this', () => {
  const { lastPullAt: _, ...oldState } = OLD_CLONE;
  function oldDb(): Database {
    const db = new Database(':memory:');
    new TelemetryStore(db);
    db.run(
      `INSERT INTO telemetry_macs (install_id, ping, verified_username, last_seen) VALUES (?, ?, 'dev1', ?)`,
      ['install-a', JSON.stringify(OLD_PING), T0]
    );
    db.run(
      `INSERT INTO telemetry_macs (install_id, ping, verified_username, last_seen) VALUES (?, ?, NULL, ?)`,
      [
        'install-b',
        JSON.stringify({
          ...OLD_PING,
          installId: 'install-b',
          orgs: [
            { org: 'acme', layout: 5, clone: null },
            { org: 'beta', layout: null },
          ],
          packs: [{ id: 'web@acme', version: null }],
        }),
        T0,
      ]
    );
    db.run(
      `INSERT INTO telemetry_clone_events (install_id, at, state) VALUES ('install-a', ?, ?)`,
      [
        T0,
        JSON.stringify({
          clones: { acme: oldState, beta: null },
          stale: { 'web@acme': OLD_STALE, 'api@acme': null },
        }),
      ]
    );
    return db;
  }

  test('lose their names and keep their counts when the store opens', () => {
    const db = oldDb();
    const s = new TelemetryStore(db);
    const rows = JSON.stringify([
      ...db.query('SELECT * FROM telemetry_macs').all(),
      ...db.query('SELECT * FROM telemetry_clone_events').all(),
    ]);
    expect(rows).not.toContain('SECRET');
    const report = s.cloneReport(T0, 'dev1');
    expect(report.macs[0]!.orgs[0]!.clone).toEqual({
      ...CLONE,
      onDataBranch: false,
      dirtyCount: 2,
    });
    expect(report.macs[0]!.packs[0]).toMatchObject({ staleCount: 2 });
    const { lastPullAt: _pulled, ...state } = CLONE;
    expect(report.events[0]!.state).toEqual({
      clones: {
        acme: { ...state, onDataBranch: false, dirtyCount: 2 },
        beta: null,
      },
      stale: { 'web@acme': 2, 'api@acme': null },
    });
    expect(s.snapshot(T0).macs).toHaveLength(2);
  });

  test('a row that cannot be read is dropped, not kept as it is', () => {
    const db = oldDb();
    db.run(
      `UPDATE telemetry_macs SET ping = '{"SECRET":' WHERE install_id = 'install-b'`
    );
    db.run(`UPDATE telemetry_clone_events SET state = 'SECRET'`);
    const s = new TelemetryStore(db);
    expect(s.snapshot(T0).macs.map(m => m.installId)).toEqual(['install-a']);
    expect(s.cloneReport(T0).events).toEqual([]);
  });

  test('a second open changes nothing', () => {
    const db = oldDb();
    new TelemetryStore(db);
    const dump = () =>
      JSON.stringify([
        ...db.query('SELECT * FROM telemetry_macs').all(),
        ...db.query('SELECT * FROM telemetry_clone_events').all(),
      ]);
    const before = dump();
    new TelemetryStore(db);
    expect(dump()).toBe(before);
  });

  test('a Mac whose state did not change adds no event after the clearing', () => {
    const db = oldDb();
    const s = new TelemetryStore(db);
    s.record(
      {
        ...ping(),
        orgs: [
          {
            org: 'acme',
            layout: 5,
            clone: { ...CLONE, onDataBranch: false, dirtyCount: 2 },
          },
          { org: 'beta', layout: null, clone: null },
        ],
        packs: [
          { id: 'web@acme', version: '0.11.67', staleCount: 2 },
          { id: 'api@acme', version: null, staleCount: null },
        ],
      },
      'dev1',
      T0 + HOUR
    );
    expect(s.cloneReport(T0 + HOUR, 'dev1').events).toHaveLength(1);
  });
});
