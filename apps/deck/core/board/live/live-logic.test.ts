import { expect, test } from 'bun:test';

import type { Row, StatusData } from '../logic.ts';
import { liveCell, liveCount, liveHealth } from './live-logic.ts';

const data = {
  devMode: true,
  canManage: true,
  apps: [],
} as unknown as StatusData;
const row = (over: Partial<Row>): Row =>
  ({ name: 'chat', managedBy: 'rt', ...over }) as Row;
const live = (
  processes: Array<{ running: boolean; kind?: string }>,
  startedAt = '2026-10-09T21:00:00Z'
) =>
  ({
    branch: 'console-runs-3',
    main: false,
    startedAt,
    uiPort: 11140,
    movedFrom: null,
    processes: processes.map((p, i) => ({
      id: `p${i}`,
      kind: p.kind ?? 'server',
      command: 'x',
      port: null,
      running: p.running,
    })),
  }) as unknown as Row['live'];
const NOW = Date.parse('2026-10-09T21:10:00Z');

test('no live controls outside dev mode, for user apps, or deck', () => {
  expect(
    liveCell(row({ liveBlocked: null }), { ...data, devMode: false }, NOW)
  ).toEqual({ kind: 'none' });
  expect(liveCell(row({ managedBy: 'user' }), data, NOW)).toEqual({
    kind: 'none',
  });
  expect(
    liveCell(row({ managedBy: 'deck', liveBlocked: null }), data, NOW)
  ).toEqual({ kind: 'none' });
});

test('go, blocked, setup, failed', () => {
  expect(liveCell(row({ liveBlocked: null }), data, NOW)).toEqual({
    kind: 'go',
  });
  expect(
    liveCell(row({ liveBlocked: 'no server in the live list' }), data, NOW)
  ).toEqual({ kind: 'blocked', reason: 'no server in the live list' });
  expect(
    liveCell(
      row({ liveSetup: { state: 'running', branch: 'a', log: [] } }),
      data,
      NOW
    )
  ).toEqual({ kind: 'setup', branch: 'a' });
  expect(
    liveCell(
      row({ liveSetup: { state: 'failed', branch: 'a', log: [] } }),
      data,
      NOW
    )
  ).toEqual({ kind: 'failed' });
});

test('live from a worktree, and starting while processes come up', () => {
  expect(liveCell(row({ live: live([{ running: true }]) }), data, NOW)).toEqual(
    { kind: 'live', label: 'console-runs-3', worktree: true, movedFrom: null }
  );
  expect(
    liveCell(
      row({ live: live([{ running: false }], '2026-10-09T21:09:50Z') }),
      data,
      NOW
    )
  ).toEqual({ kind: 'starting' });
});

test('health names the process that is down once starting is over', () => {
  expect(
    liveHealth(
      row({ live: live([{ running: true }, { running: false, kind: 'ui' }]) }),
      NOW
    )
  ).toEqual({ tone: 'bad', text: 'ui down' });
  expect(liveHealth(row({ live: live([{ running: true }]) }), NOW)).toBeNull();
  expect(liveHealth(row({}), NOW)).toBeNull();
});

test('liveCount counts live rows', () => {
  expect(
    liveCount({
      ...data,
      apps: [row({ live: live([]) }), row({})],
    } as StatusData)
  ).toBe(1);
});
