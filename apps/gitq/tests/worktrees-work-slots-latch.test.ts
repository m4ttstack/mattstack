import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { getSetting } from '@mattstack/rt-client';
import { getMaxWorkSlots, getWorkSlotLocation } from '../src/core/worktrees.ts';
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

async function sandboxConfigDir(fileSettings: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gitq-work-slots-latch-'));
  cleanups.push(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'settings.json'), JSON.stringify(fileSettings));
  return dir;
}

/** Runs `fn` with the config dir pointed at `dir`, always restoring after. */
async function withConfigDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const restore = getConfigDir();
  setConfigDir(dir);
  try {
    return await fn();
  } finally {
    setConfigDir(restore);
  }
}

describe('getMaxWorkSlots: store-wins-per-key latch', () => {
  test('unowned gitq.workSlots falls back to settings.json', async () => {
    const dir = await sandboxConfigDir({ maxWorkSlots: 5 });
    await withConfigDir(dir, async () => {
      expect(await getMaxWorkSlots(fakeResolve({}))).toBe(5);
    });
  });

  test('a store-owned maxWorkSlots wins over settings.json', async () => {
    const dir = await sandboxConfigDir({ maxWorkSlots: 5 });
    await withConfigDir(dir, async () => {
      expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 9 } }))).toBe(9);
    });
  });

  test('store owning only workSlotLocation leaves maxWorkSlots on the file value', async () => {
    const dir = await sandboxConfigDir({ maxWorkSlots: 5 });
    await withConfigDir(dir, async () => {
      expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { workSlotLocation: 'root' } }))).toBe(5);
    });
  });

  test('a resolver throw degrades to settings.json, never crashes', async () => {
    const dir = await sandboxConfigDir({ maxWorkSlots: 5 });
    await withConfigDir(dir, async () => {
      expect(await getMaxWorkSlots(throwingResolve())).toBe(5);
    });
  });

  test('a resolver throw warns exactly once, without echoing the thrown error into a value', async () => {
    const dir = await sandboxConfigDir({});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withConfigDir(dir, async () => {
        await getMaxWorkSlots(throwingResolve('rt daemon unreachable'));
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('an invalid store maxWorkSlots falls back to the same default a bad file value gets', async () => {
    const dir = await sandboxConfigDir({});
    await withConfigDir(dir, async () => {
      expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 0 } }))).toBe(3);
      expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 'nine' } }))).toBe(3);
    });
  });
});

describe('getWorkSlotLocation: store-wins-per-key latch', () => {
  test('unowned gitq.workSlots falls back to settings.json', async () => {
    const dir = await sandboxConfigDir({ workSlotLocation: 'root' });
    await withConfigDir(dir, async () => {
      expect(await getWorkSlotLocation(fakeResolve({}))).toBe('root');
    });
  });

  test('a store-owned workSlotLocation wins over settings.json', async () => {
    const dir = await sandboxConfigDir({ workSlotLocation: 'auto' });
    await withConfigDir(dir, async () => {
      expect(await getWorkSlotLocation(fakeResolve({ 'gitq.workSlots': { workSlotLocation: 'root' } }))).toBe('root');
    });
  });

  test('store owning only maxWorkSlots leaves workSlotLocation on the file value', async () => {
    const dir = await sandboxConfigDir({ workSlotLocation: 'root' });
    await withConfigDir(dir, async () => {
      expect(await getWorkSlotLocation(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 9 } }))).toBe('root');
    });
  });

  test('a resolver throw degrades to settings.json, never crashes', async () => {
    const dir = await sandboxConfigDir({ workSlotLocation: 'root' });
    await withConfigDir(dir, async () => {
      expect(await getWorkSlotLocation(throwingResolve())).toBe('root');
    });
  });

  test('an unrecognised store workSlotLocation falls back to "auto", same as a bad file value', async () => {
    const dir = await sandboxConfigDir({});
    await withConfigDir(dir, async () => {
      expect(await getWorkSlotLocation(fakeResolve({ 'gitq.workSlots': { workSlotLocation: 'nowhere' } }))).toBe('auto');
    });
  });
});

describe('getMaxWorkSlots / getWorkSlotLocation: real getSetting against the fake-HOME store', () => {
  test('a real gitq.workSlots write in the machine store wins over settings.json', async () => {
    const { setSetting } = await import('@mattstack/rt-client');
    const dir = await sandboxConfigDir({ maxWorkSlots: 5, workSlotLocation: 'auto' });
    await withConfigDir(dir, async () => {
      setSetting('gitq.workSlots', { maxWorkSlots: 7, workSlotLocation: 'root' }, 'machine');
      expect(await getMaxWorkSlots()).toBe(7);
      expect(await getWorkSlotLocation()).toBe('root');
    });
  });
});
