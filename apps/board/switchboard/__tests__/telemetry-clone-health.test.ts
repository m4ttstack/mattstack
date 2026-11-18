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
  branch: 'mattstack',
  dataBranch: 'mattstack',
  head: 'aaaaaaaaaaaa',
  upstream: 'aaaaaaaaaaaa',
  behind: 0,
  ahead: 0,
  lastPullAt: new Date(T0 - HOUR).toISOString(),
  pull: 'ok',
  canPublish: false,
  dirtyCount: 0,
  dirty: [],
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
        stale: [{ skill: 'work', causes: ['source'] }],
      },
    ],
    appUpdate: null,
    ...over,
  };
}

const store = () => new TelemetryStore(new Database(':memory:'));

describe('parsePing clone health', () => {
  test('keeps a clone block and a pack stale list', () => {
    const parsed = parsePing(JSON.parse(JSON.stringify(ping())));
    expect(parsed?.orgs[0]?.clone).toEqual(CLONE);
    expect(parsed?.packs[0]?.stale).toEqual([
      { skill: 'work', causes: ['source'] },
    ]);
  });

  test('a dirty path longer than other strings is still accepted', () => {
    const path = `mattstack/teams/web/plugin/${'a/'.repeat(80)}SKILL.md`;
    const parsed = parsePing(
      ping({
        orgs: [
          {
            org: 'acme',
            layout: 5,
            clone: { ...CLONE, dirtyCount: 1, dirty: [{ path, status: 'M' }] },
          },
        ],
      })
    );
    expect(parsed?.orgs[0]?.clone?.dirty[0]?.path).toBe(path);
  });

  test('a malformed clone or stale list reads as null and keeps the ping', () => {
    const parsed = parsePing(
      ping({
        orgs: [{ org: 'acme', layout: 5, clone: { pull: 42 } as never }],
        packs: [{ id: 'web@acme', version: null, stale: 'nope' as never }],
      })
    );
    expect(parsed?.orgs[0]?.clone).toBeNull();
    expect(parsed?.packs[0]?.stale).toBeNull();
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
              dirty: [
                {
                  path: 'mattstack/teams/web/plugin/skills/work/SKILL.md',
                  status: 'M',
                },
              ],
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
    expect(report.events[1]!.state.stale['web@acme']).toEqual([
      { skill: 'work', causes: ['source'] },
    ]);
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
