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
  home = mkdtempSync(join(tmpdir(), 'deck-plat-railway-home-'));
  process.env.HOME = home;
  process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`;
  reloadPlatformSettings();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

test('railway defaults to null and round-trips through the store', () => {
  expect(getPlatformSettings().railway).toBeNull();
  updatePlatformSettings({ railway: { projectId: 'p1', environmentId: 'e1' } });
  expect(
    getSetting<{ railway: unknown }>('deck.platform').value.railway
  ).toEqual({ projectId: 'p1', environmentId: 'e1' });
  reloadPlatformSettings();
  expect(getPlatformSettings().railway).toEqual({
    projectId: 'p1',
    environmentId: 'e1',
  });
});
