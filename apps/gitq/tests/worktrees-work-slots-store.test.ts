import { describe, test, expect, spyOn } from 'bun:test';
import { getSetting, setSetting } from '@mattstack/rt-client';
import { useOwnHome } from './own-home.ts';
import { getMaxWorkSlots, getWorkSlotLocation } from '../src/core/worktrees.ts';
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

useOwnHome();

describe('getMaxWorkSlots (fake resolver, no real store IO)', () => {
  test('a stored maxWorkSlots is read', async () => {
    expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 9 } }))).toBe(9);
  });

  test('a stored fractional maxWorkSlots is floored', async () => {
    expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 4.8 } }))).toBe(4);
  });

  test('a store owning only workSlotLocation reads the default cap', async () => {
    expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { workSlotLocation: 'root' } }))).toBe(3);
  });

  test('an invalid maxWorkSlots reads the default', async () => {
    expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 0 } }))).toBe(3);
    expect(await getMaxWorkSlots(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 'nine' } }))).toBe(3);
  });

  test('a resolver throw warns once per process, then suppresses repeats -- across both readers, since they share one key', async () => {
    resetStoreFallbackWarnings();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await getMaxWorkSlots(throwingResolve('rt daemon unreachable'));
      await getMaxWorkSlots(throwingResolve('rt daemon unreachable'));
      await getWorkSlotLocation(throwingResolve('rt daemon unreachable'));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('the warning never prints the raw Error object, only its message', async () => {
    resetStoreFallbackWarnings();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await getMaxWorkSlots(throwingResolve('rt daemon unreachable'));
      const args = warn.mock.calls[0]!;
      expect(args.some((a) => a instanceof Error)).toBe(false);
      expect(args.join(' ')).toContain('rt daemon unreachable');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getWorkSlotLocation (fake resolver, no real store IO)', () => {
  test('a stored workSlotLocation is read', async () => {
    expect(await getWorkSlotLocation(fakeResolve({ 'gitq.workSlots': { workSlotLocation: 'root' } }))).toBe('root');
  });

  test('a store owning only maxWorkSlots reads auto', async () => {
    expect(await getWorkSlotLocation(fakeResolve({ 'gitq.workSlots': { maxWorkSlots: 9 } }))).toBe('auto');
  });

  test('an unrecognised workSlotLocation reads auto', async () => {
    expect(await getWorkSlotLocation(fakeResolve({ 'gitq.workSlots': { workSlotLocation: 'nowhere' } }))).toBe('auto');
  });
});

describe('getMaxWorkSlots / getWorkSlotLocation: real getSetting against the fake-HOME store', () => {
  test('nothing set reads the registry default: auto placement, three slots', async () => {
    expect(await getWorkSlotLocation()).toBe('auto');
    expect(await getMaxWorkSlots()).toBe(3);
  });

  test('a resolver throw reads the default after one warning, never crashes', async () => {
    const throwing = (() => {
      throw new Error('store unreadable');
    }) as unknown as typeof getSetting;
    expect(await getMaxWorkSlots(throwing)).toBe(3);
    expect(await getWorkSlotLocation(throwing)).toBe('auto');
  });

  test('an invalid maxWorkSlots in the store reads the default', async () => {
    setSetting('gitq.workSlots', { maxWorkSlots: 0 }, 'machine');
    expect(await getMaxWorkSlots()).toBe(3);
  });

  test('a real gitq.workSlots write in the machine store is read back', async () => {
    setSetting('gitq.workSlots', { maxWorkSlots: 7, workSlotLocation: 'root' }, 'machine');
    expect(await getMaxWorkSlots()).toBe(7);
    expect(await getWorkSlotLocation()).toBe('root');
  });
});
