import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { getSetting } from '@mattstack/rt-client';
import { loadConfig, type BoardConfig } from '../src/server/config.ts';

type GetSettingFn = typeof getSetting;

/** Matches getSetting's shape without touching any real store -- same
    stand-in precedent as the forges/work-slots store-latch tests. */
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

/** Writes a scratch config.json and returns its path, standing in for CONFIG_PATH. */
async function sandboxConfigFile(fileConfig: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gitq-board-config-latch-'));
  cleanups.push(dir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify(fileConfig));
  return path;
}

const fileConfig = { repos: [{ path: '/r/file' }], port: 11008, herdrWorkspace: 'gitq' };
const storedConfig = { repos: [{ path: '/r/store' }], port: 9999, herdrWorkspace: 'stacks' };

describe('loadConfig: store-wins-wholesale latch (fake resolver, no real store IO)', () => {
  test('unowned gitq.board falls back to config.json', async () => {
    const configPath = await sandboxConfigFile(fileConfig);
    const cfg = loadConfig(fakeResolve({}), configPath);
    expect(cfg).toEqual({ repos: [{ path: '/r/file', name: 'file' }], port: 11008, herdrWorkspace: 'gitq' });
  });

  test('an owned gitq.board wins wholesale, replacing config.json rather than merging with it', async () => {
    const configPath = await sandboxConfigFile(fileConfig);
    const cfg = loadConfig(fakeResolve({ 'gitq.board': storedConfig }), configPath);
    expect(cfg).toEqual({ repos: [{ path: '/r/store', name: 'store' }], port: 9999, herdrWorkspace: 'stacks' });
  });

  test('a resolver throw degrades to config.json, never crashes', async () => {
    const configPath = await sandboxConfigFile(fileConfig);
    const cfg = loadConfig(throwingResolve(), configPath);
    expect(cfg.repos[0]!.path).toBe('/r/file');
  });

  test('a resolver throw warns exactly once', async () => {
    const configPath = await sandboxConfigFile(fileConfig);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadConfig(throwingResolve('rt daemon unreachable'), configPath);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('a store gitq.board with an invalid port fails the same way a bad config.json does', async () => {
    const configPath = await sandboxConfigFile(fileConfig);
    const bad = { repos: [{ path: '/r' }], port: 'nope' };
    expect(() => loadConfig(fakeResolve({ 'gitq.board': bad }), configPath)).toThrow('"port"');
  });

  test('a store gitq.board with an empty repos array fails the same way an empty config.json repos does', async () => {
    const configPath = await sandboxConfigFile(fileConfig);
    const bad = { repos: [] };
    expect(() => loadConfig(fakeResolve({ 'gitq.board': bad }), configPath)).toThrow('non-empty "repos"');
  });

  test('no config.json and no store value throws the missing-config error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gitq-board-config-missing-'));
    cleanups.push(dir);
    const missingPath = join(dir, 'config.json');
    expect(() => loadConfig(fakeResolve({}), missingPath)).toThrow('no config.json at');
  });
});

describe('loadConfig: real getSetting against the fake-HOME store', () => {
  test('a real gitq.board write in the machine store wins wholesale over config.json', async () => {
    const { setSetting } = await import('@mattstack/rt-client');
    // Own HOME for this write, same contract as home-isolation.test.ts: the
    // resolver reads process.env.HOME at call time, so a write here without
    // its own HOME would land in the process-wide fake HOME every other
    // test file shares and leak store ownership of gitq.board to them.
    const prevHome = process.env.HOME;
    const ownHome = mkdtempSync(join(tmpdir(), 'gitq-board-real-store-'));
    if (ownHome === homedir()) {
      throw new Error('refusing to touch the real account home');
    }
    process.env.HOME = ownHome;
    try {
      const configPath = await sandboxConfigFile(fileConfig);
      const stored: BoardConfig = {
        repos: [{ path: '/r/real-store', name: 'real-store' }],
        port: 12345,
        herdrWorkspace: 'real',
      };
      setSetting('gitq.board', stored, 'machine');
      const cfg = loadConfig(undefined, configPath);
      expect(cfg).toEqual(stored);
    } finally {
      process.env.HOME = prevHome;
      await rm(ownHome, { recursive: true, force: true });
    }
  });
});
