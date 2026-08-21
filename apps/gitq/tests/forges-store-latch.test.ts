import { describe, test, expect, spyOn, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { getSetting } from '@mattstack/rt-client';
import { readForgeOverrides, resolveForge, type ForgeOverrides } from '../src/core/forges.ts';
import { resetStoreFallbackWarnings } from '../src/core/settings-fallback-warn.ts';
import { getConfigDir, setConfigDir } from '../src/core/config-paths.ts';

type GetSettingFn = typeof getSetting;

/** Matches getSetting's shape without touching any real store -- same
    stand-in precedent as mr-board's config-store-latch tests. */
function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({ value: values[key] as T, provenance: [] })) as GetSettingFn;
}

function throwingResolve(message = 'rt daemon unreachable'): GetSettingFn {
  return (() => {
    throw new Error(message);
  }) as GetSettingFn;
}

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

async function withSandboxConfigDir<T>(fileSettings: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'gitq-forges-latch-'));
  cleanups.push(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'settings.json'), JSON.stringify(fileSettings));
  const restore = getConfigDir();
  setConfigDir(dir);
  try {
    return await fn();
  } finally {
    setConfigDir(restore);
  }
}

describe('readForgeOverrides: store-wins-wholesale latch (fake resolver, no real store IO)', () => {
  test('unowned gitq.forges resolves to an empty map when settings.json has nothing either', async () => {
    expect(await readForgeOverrides(fakeResolve({}))).toEqual({});
  });

  test('unowned gitq.forges falls back to settings.json\'s map', async () => {
    const fileForges: ForgeOverrides = { 'gitlab.file.example': { provider: 'gitlab' } };
    await withSandboxConfigDir({ forges: fileForges }, async () => {
      expect(await readForgeOverrides(fakeResolve({}))).toEqual(fileForges);
    });
  });

  test('an owned gitq.forges wins wholesale, replacing a populated settings.json rather than merging with it', async () => {
    const stored: ForgeOverrides = { 'gitlab.acme.com': { provider: 'gitlab' } };
    const fileForges: ForgeOverrides = { 'gitlab.file.example': { provider: 'gitlab' } };
    await withSandboxConfigDir({ forges: fileForges }, async () => {
      expect(await readForgeOverrides(fakeResolve({ 'gitq.forges': stored }))).toEqual(stored);
    });
  });

  test('an owned EMPTY gitq.forges still wins wholesale: the file\'s entries are gone, not merged in', async () => {
    // {} is a legitimate owned value ("no overrides"), distinct from
    // undefined ("unowned"). If ownership were mistaken for `??`-style
    // fallback, an empty store map would let the file's entries show
    // through; the whole point of "wholesale" is that it doesn't.
    const fileForges: ForgeOverrides = { 'gitlab.file.example': { provider: 'gitlab' } };
    await withSandboxConfigDir({ forges: fileForges }, async () => {
      expect(await readForgeOverrides(fakeResolve({ 'gitq.forges': {} }))).toEqual({});
    });
  });

  test('a resolver throw degrades to the (empty, no file present) map, never crashes', async () => {
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

  test('a store forges map with a bad provider fails resolveForge the same way a bad file map does', async () => {
    const stored = { 'git.acme.com': { provider: 'gitlub' } } as unknown as ForgeOverrides;
    const overrides = await readForgeOverrides(fakeResolve({ 'gitq.forges': stored }));
    expect(() => resolveForge('git.acme.com', overrides)).toThrow(/git\.acme\.com.*gitlab.*github/s);
  });

  test('a store forges ssh-alias entry with no baseUrl fails resolveForge the same way a bad file entry does', async () => {
    const stored: ForgeOverrides = { work: { provider: 'gitlab' } };
    const overrides = await readForgeOverrides(fakeResolve({ 'gitq.forges': stored }));
    expect(() => resolveForge('work', overrides)).toThrow(/baseUrl/);
  });

  test('a store-owned forges map resolves a good entry exactly like a file one would', async () => {
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
  test('a real gitq.forges write in the user store wins wholesale over settings.json', async () => {
    const { setSetting } = await import('@mattstack/rt-client');
    // Own HOME for this write, same contract as home-isolation.test.ts: the
    // resolver reads process.env.HOME at call time, so a write here without
    // its own HOME would land in the process-wide fake HOME every other
    // test file shares -- including home-isolation.test.ts's own gitq.forges
    // write, whose assertion that the store file does not exist yet would
    // then race this test's file-run order.
    const prevHome = process.env.HOME;
    const ownHome = mkdtempSync(join(tmpdir(), 'gitq-forges-real-store-'));
    if (ownHome === homedir()) {
      throw new Error('refusing to touch the real account home');
    }
    process.env.HOME = ownHome;
    try {
      const stored: ForgeOverrides = { 'gitlab.real-store.example': { provider: 'gitlab' } };
      setSetting('gitq.forges', stored, 'user');
      const overrides = await readForgeOverrides();
      expect(overrides).toEqual(stored);
      expect(resolveForge('gitlab.real-store.example', overrides)?.slug).toBe('gitlab');
    } finally {
      process.env.HOME = prevHome;
      await rm(ownHome, { recursive: true, force: true });
    }
  });
});
