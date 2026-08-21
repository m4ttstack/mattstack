import { describe, test, expect, spyOn, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { getSetting } from '@mattstack/rt-client';
import { readForgeOverrides, resolveForge, type ForgeOverrides } from '../src/core/forges.ts';
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

  test('a resolver throw degrades to the (empty, no file present) map, never crashes', async () => {
    expect(await readForgeOverrides(throwingResolve())).toEqual({});
  });

  test('a resolver throw warns exactly once', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await readForgeOverrides(throwingResolve('rt daemon unreachable'));
      expect(warn).toHaveBeenCalledTimes(1);
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

// A real-getSetting-against-the-fake-HOME case is covered in
// worktrees-work-slots-latch.test.ts, on gitq.workSlots (machine scope).
// Not duplicated here on gitq.forges (user scope): home-isolation.test.ts
// asserts that store file does NOT exist yet, and test files share one
// process-wide fake HOME (tests/preload.ts) -- a real write to the same
// key/scope here would race that assertion depending on file run order.
