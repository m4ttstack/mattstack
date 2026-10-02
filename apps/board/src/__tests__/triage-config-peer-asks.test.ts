import { describe, expect, test } from 'bun:test';

import type { getSetting } from '@mattstack/rt-client';
import { loadPeerAsksConfig } from '../triage/config.ts';

type GetSettingFn = typeof getSetting;

function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T>(key: string) => ({
    value: values[key] as T,
    provenance: [],
  })) as GetSettingFn;
}

describe('loadPeerAsksConfig', () => {
  test('unset defaults to enabled: a new member gets automatic asks', () => {
    expect(loadPeerAsksConfig(fakeResolve({}))).toEqual({ enabled: true });
  });

  test('{ enabled: false } turns automatic asks off', () => {
    expect(
      loadPeerAsksConfig(fakeResolve({ 'board.peerAsks': { enabled: false } }))
    ).toEqual({ enabled: false });
  });

  test('a resolver throw degrades to enabled, never crashes', () => {
    const throwing = (() => {
      throw new Error('unknown settings key: board.peerAsks');
    }) as GetSettingFn;
    expect(loadPeerAsksConfig(throwing)).toEqual({ enabled: true });
  });

  test('a non-boolean enabled is a loud config error', () => {
    expect(() =>
      loadPeerAsksConfig(fakeResolve({ 'board.peerAsks': { enabled: 'yes' } }))
    ).toThrow('"enabled" must be a boolean');
  });

  test('does not read board.triage: auto-doctor stays a separate opt-in', () => {
    expect(
      loadPeerAsksConfig(fakeResolve({ 'board.triage': { enabled: false } }))
    ).toEqual({ enabled: true });
  });
});
