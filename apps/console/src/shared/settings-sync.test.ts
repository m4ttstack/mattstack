import { describe, expect, it } from 'vitest';

import { deriveSyncState, type TeamStatusJson } from './settings-sync';

const NOW = Date.parse('2026-11-23T12:00:00.000Z');

function status(over: Partial<TeamStatusJson> = {}): TeamStatusJson {
  return {
    branch: 'mattstack',
    trial: false,
    lastPull: '2026-11-23T11:58:00.000Z',
    lastPushAt: '2026-11-23T11:50:00.000Z',
    conflicted: null,
    pullOnly: false,
    heldBack: [],
    pending: [],
    lastPushError: null,
    lastCommitError: null,
    lastPullError: null,
    layoutHold: false,
    unownedDirty: [],
    pullIntervalSec: 300,
    ...over,
  };
}

describe('deriveSyncState', () => {
  it('a missing status reads unknown', () => {
    expect(deriveSyncState(null, NOW)).toEqual({ kind: 'unknown' });
  });

  it('pending null reads unknown', () => {
    expect(deriveSyncState(status({ pending: null }), NOW)).toEqual({
      kind: 'unknown',
    });
  });

  it('a conflict reads stuck before anything else', () => {
    const s = status({
      conflicted: {
        at: '2026-11-23T11:00:00.000Z',
        detail: 'settings.team.jsonc',
      },
      lastPushError: 'fatal: 403',
    });
    expect(deriveSyncState(s, NOW)).toEqual({
      kind: 'stuck',
      reason: 'conflict',
      detail: 'settings.team.jsonc',
    });
  });

  it('a push error reads stuck push-failed', () => {
    const s = status({
      lastPushError: 'fatal: 403',
      lastCommitError: 'x',
      pending: [{ path: '.sops.yaml' }],
    });
    expect(deriveSyncState(s, NOW)).toEqual({
      kind: 'stuck',
      reason: 'push-failed',
      detail: 'fatal: 403',
    });
  });

  it('a commit error reads stuck commit-failed', () => {
    expect(
      deriveSyncState(status({ lastCommitError: 'index.lock exists' }), NOW)
    ).toEqual({
      kind: 'stuck',
      reason: 'commit-failed',
      detail: 'index.lock exists',
    });
  });

  it('a pull error reads stuck unreachable', () => {
    expect(
      deriveSyncState(status({ lastPullError: 'could not read Username' }), NOW)
    ).toEqual({
      kind: 'stuck',
      reason: 'unreachable',
      detail: 'could not read Username',
    });
  });

  it('stale pull reads stuck', () => {
    const s = status({ lastPull: '2026-11-23T11:49:00.000Z', pending: [] });
    expect(deriveSyncState(s, NOW)).toEqual({
      kind: 'stuck',
      reason: 'unreachable',
      detail: null,
    });
  });

  it('a pull just inside twice the interval is not stale', () => {
    expect(
      deriveSyncState(status({ lastPull: '2026-11-23T11:50:01.000Z' }), NOW)
        .kind
    ).toBe('pushed');
  });

  it('a trial branch reads stuck trial even with nothing waiting', () => {
    expect(
      deriveSyncState(status({ trial: true, branch: 'try-layout-6' }), NOW)
    ).toEqual({
      kind: 'stuck',
      reason: 'trial',
      detail: 'try-layout-6',
    });
  });

  it('a layout hold reads stuck layout-hold', () => {
    expect(deriveSyncState(status({ layoutHold: true }), NOW)).toEqual({
      kind: 'stuck',
      reason: 'layout-hold',
      detail: null,
    });
  });

  it('waiting entries read waiting with their count', () => {
    const s = status({
      pending: [
        { store: 'team:web', key: 'board.slack', change: 'changed' },
        { path: '.claude-plugin/marketplace.json', heldBack: true },
      ],
    });
    expect(deriveSyncState(s, NOW)).toEqual({ kind: 'waiting', count: 2 });
  });

  it('nothing waiting reads pushed with lastPushAt', () => {
    expect(deriveSyncState(status(), NOW)).toEqual({
      kind: 'pushed',
      lastPushAt: Date.parse('2026-11-23T11:50:00.000Z'),
    });
  });

  it('nothing waiting and no push yet reads pushed with a null time', () => {
    expect(deriveSyncState(status({ lastPushAt: null }), NOW)).toEqual({
      kind: 'pushed',
      lastPushAt: null,
    });
  });
});
