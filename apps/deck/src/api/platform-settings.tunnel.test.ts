import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { getSetting } from '@mattstack/rt-client';
import {
  getPlatformSettings,
  reloadPlatformSettings,
  updatePlatformSettings,
} from './platform-settings.ts';

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'deck-plat-tunnel-home-'));
  process.env.HOME = home;
  process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`;
  reloadPlatformSettings();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

test('tunnel defaults to null and round-trips through the store', () => {
  expect(getPlatformSettings().tunnel).toBeNull();
  updatePlatformSettings({
    tunnel: { name: 'deck-edge-mbp-abc123', uuid: 'u-1' },
  });
  expect(getSetting<{ tunnel: unknown }>('deck.platform').value.tunnel).toEqual(
    { name: 'deck-edge-mbp-abc123', uuid: 'u-1' }
  );
  reloadPlatformSettings();
  expect(getPlatformSettings().tunnel).toEqual({
    name: 'deck-edge-mbp-abc123',
    uuid: 'u-1',
  });
});

test('tunnel: null clears a recorded identity', () => {
  updatePlatformSettings({ tunnel: { name: 'n', uuid: 'u' } });
  updatePlatformSettings({ tunnel: null });
  reloadPlatformSettings();
  expect(getPlatformSettings().tunnel).toBeNull();
  expect(
    getSetting<{ tunnel: unknown }>('deck.platform').value.tunnel
  ).toBeNull();
});
