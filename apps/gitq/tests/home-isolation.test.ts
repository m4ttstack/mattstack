import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSetting, setSetting } from '@mattstack/rt-client';

/**
 * Guards tests/preload.ts's HOME isolation. rt-client's settings stores
 * resolve process.env.HOME at call time (not os.homedir(), which is
 * syscall-backed and stays the real account home no matter what the
 * preload sets) -- so every assertion below checks fakeHome !== homedir()
 * BEFORE touching the filesystem. If that check ever fails (preload
 * regressed), the test must stop there rather than call setSetting, which
 * would otherwise write into the real ~/.mattstack/user store.
 */
describe('HOME isolation (rt-client settings)', () => {
  test('preload repoints HOME away from the real account home', () => {
    const fakeHome = process.env.HOME;
    expect(fakeHome).toBeTruthy();
    expect(fakeHome).not.toBe(homedir());
  });

  test('getSetting/setSetting resolve the user store under the fake HOME', () => {
    const fakeHome = process.env.HOME;
    if (fakeHome === undefined || fakeHome === homedir()) {
      throw new Error('HOME is not isolated from the real account home -- refusing to touch a real store');
    }

    const storePath = join(fakeHome, '.mattstack', 'user', 'settings.user.jsonc');
    expect(existsSync(storePath)).toBe(false);

    const written = { 'guard.example.test': { tokenEnv: 'GUARD_TEST_TOKEN' } };
    setSetting('gitq.forges', written, 'user');

    expect(existsSync(storePath)).toBe(true);
    const resolved = getSetting<typeof written>('gitq.forges', {});
    expect(resolved.value).toEqual(written);
    expect(resolved.provenance).toEqual([{ scope: 'user', file: storePath }]);
  });
});
