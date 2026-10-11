import { describe, test, expect, spyOn, afterEach } from 'bun:test';
import { getSetting, setSetting, unsetSetting } from '@mattstack/rt-client';
import { readForgeOverrides, resolveForge, type ForgeOverrides } from '../src/core/forges.ts';
import { resetStoreFallbackWarnings } from '../src/core/settings-fallback-warn.ts';

type GetSettingFn = typeof getSetting;

/** Matches getSetting's shape without touching any real store. */
function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({ value: values[key] as T, provenance: [] })) as GetSettingFn;
}

function throwingResolve(message = 'rt daemon unreachable'): GetSettingFn {
  return (() => {
    throw new Error(message);
  }) as GetSettingFn;
}

afterEach(() => {
  unsetSetting('gitq.forges', 'user');
});

describe('readForgeOverrides (fake resolver, no real store IO)', () => {
  test('a resolver throw degrades to the empty map, never crashes', async () => {
    expect(await readForgeOverrides(throwingResolve())).toEqual({});
  });

  test('a resolver throw warns once per process, then suppresses repeats', async () => {
    resetStoreFallbackWarnings();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await readForgeOverrides(throwingResolve('rt daemon unreachable'));
      await readForgeOverrides(throwingResolve('rt daemon unreachable'));
      await readForgeOverrides(throwingResolve('rt daemon unreachable'));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('the warning never prints the raw Error object, only its message', async () => {
    resetStoreFallbackWarnings();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await readForgeOverrides(throwingResolve('rt daemon unreachable'));
      const args = warn.mock.calls[0]!;
      expect(args.some((a) => a instanceof Error)).toBe(false);
      expect(args.join(' ')).toContain('rt daemon unreachable');
    } finally {
      warn.mockRestore();
    }
  });

  test('a store forges map with a bad provider fails resolveForge', async () => {
    const stored = { 'git.acme.com': { provider: 'gitlub' } } as unknown as ForgeOverrides;
    const overrides = await readForgeOverrides(fakeResolve({ 'gitq.forges': stored }));
    expect(() => resolveForge('git.acme.com', overrides)).toThrow(/git\.acme\.com.*gitlab.*github/s);
  });

  test('a store forges ssh-alias entry with no baseUrl fails resolveForge', async () => {
    const stored: ForgeOverrides = { work: { provider: 'gitlab' } };
    const overrides = await readForgeOverrides(fakeResolve({ 'gitq.forges': stored }));
    expect(() => resolveForge('work', overrides)).toThrow(/baseUrl/);
  });

  test('a store forges map resolves a good entry', async () => {
    const stored: ForgeOverrides = { 'ghe.acme.com': { provider: 'github', baseUrl: 'https://ghe.acme.com/git', tokenEnv: 'GHE_TOKEN' } };
    const overrides = await readForgeOverrides(fakeResolve({ 'gitq.forges': stored }));
    expect(resolveForge('ghe.acme.com', overrides)).toEqual({
      slug: 'github',
      baseUrl: 'https://ghe.acme.com/git',
      host: 'ghe.acme.com',
      tokenEnv: 'GHE_TOKEN',
    });
  });
});

describe('readForgeOverrides: real getSetting against the fake-HOME store', () => {
  test('no forges set is an empty map', async () => {
    expect(await readForgeOverrides()).toEqual({});
  });

  test('a real gitq.forges write in the user store is read back', async () => {
    const stored: ForgeOverrides = { 'gitlab.real-store.example': { provider: 'gitlab' } };
    setSetting('gitq.forges', stored, 'user');
    const overrides = await readForgeOverrides();
    expect(overrides).toEqual(stored);
    expect(resolveForge('gitlab.real-store.example', overrides)?.slug).toBe('gitlab');
  });
});
