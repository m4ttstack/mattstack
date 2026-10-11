import { describe, test, expect } from 'bun:test';
import { getSetting, setSetting } from '@mattstack/rt-client';
import { isolateHome } from './own-home.ts';
import { loadConfig, type BoardConfig } from '../src/server/config.ts';

type GetSettingFn = typeof getSetting;

/** Matches getSetting's shape without touching any real store; a key with no value reads as default-only provenance. */
function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({
    value: values[key] as T,
    provenance: [{ scope: key in values ? 'machine' : 'default' }],
  })) as unknown as GetSettingFn;
}

isolateHome();

const storedConfig = { repos: [{ path: '/r/store' }], port: 9999, herdrWorkspace: 'stacks' };

describe('loadConfig (fake resolver, no real store IO)', () => {
  test('a stored gitq.board is read, validated and given its names', () => {
    const cfg = loadConfig(fakeResolve({ 'gitq.board': storedConfig }));
    expect(cfg).toEqual({ repos: [{ path: '/r/store', name: 'store' }], port: 9999, herdrWorkspace: 'stacks' });
  });

  test('a resolver throw propagates: gitq.board has no default to fall back on', () => {
    const throwing = (() => {
      throw new Error('rt daemon unreachable');
    }) as unknown as GetSettingFn;
    expect(() => loadConfig(throwing)).toThrow('rt daemon unreachable');
  });

  test('a stored gitq.board with an invalid port fails validation', () => {
    const bad = { repos: [{ path: '/r' }], port: 'nope' };
    expect(() => loadConfig(fakeResolve({ 'gitq.board': bad }))).toThrow('"port"');
  });

  test('a stored gitq.board with an empty repos array fails validation', () => {
    const bad = { repos: [] };
    expect(() => loadConfig(fakeResolve({ 'gitq.board': bad }))).toThrow('non-empty "repos"');
  });

  test('a stored gitq.board that is not an object fails validation', () => {
    expect(() => loadConfig(fakeResolve({ 'gitq.board': 'repo' }))).toThrow('gitq.board must be a JSON object');
  });
});

describe('loadConfig: real getSetting against the fake-HOME store', () => {
  test('no gitq.board in the store is a startup failure that names how to set one', () => {
    expect(() => loadConfig()).toThrow('no "gitq.board" in your settings');
  });

  test('a real gitq.board write in the machine store is read back', () => {
    const stored: BoardConfig = {
      repos: [{ path: '/r/real-store', name: 'real-store' }],
      port: 12345,
      herdrWorkspace: 'real',
    };
    setSetting('gitq.board', stored, 'machine');
    expect(loadConfig()).toEqual(stored);
  });
});
