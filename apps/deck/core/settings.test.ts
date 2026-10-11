import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import {
  explainSetting,
  getDef,
  getSetting,
  setSetting,
  validateWrite,
} from '@mattstack/rt-client';

// rt-client doesn't export its user-store path helper; this literal is
// duplicated from rt-client/src/settings/paths.ts#userSettingsPath (which
// itself documents duplicating it from repo-tools/lib/rt-paths.ts) for the
// same reason platform-settings.test.ts duplicates the machine one: no
// dependency from here on rt-client's internals, only its public API.
function userStorePath(): string {
  return join(process.env.HOME!, '.mattstack', 'user', 'settings.user.jsonc');
}

/** Writes the user store past rt-client's write gate, for a value the resolver refuses or cannot expand. */
function seedUserStore(key: string, value: unknown): void {
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(userStorePath(), JSON.stringify({ [key]: value }));
}

// Point the module at a throwaway file BEFORE importing it.
const dir = mkdtempSync(join(tmpdir(), 'la-settings-'));
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, 'settings.json');

const {
  getAppSettings,
  getSecret,
  setPublished,
  setPassword,
  clearPassword,
  reloadSettings,
  getOverride,
  setOverride,
  clearOverride,
  getOverrides,
  getPublicFollowsOverride,
  setPublicFollowsOverride,
  renameAppSettings,
  getLive,
  setLive,
  clearLive,
  getLives,
  importFileFields,
} = await import('./settings.ts');

const origHome = process.env.HOME;
let home: string;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset to an empty file between tests.
  Bun.write(
    process.env.LOCAL_APPS_SETTINGS_PATH!,
    JSON.stringify({ version: 1, apps: {} })
  );
  home = mkdtempSync(join(tmpdir(), 'la-settings-home-'));
  process.env.HOME = home;
  reloadSettings();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function writeLegacyFile(body: Record<string, unknown>): void {
  writeFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, JSON.stringify(body));
}

test('absent app defaults to published, no password, version 0', () => {
  const s = getAppSettings('ghost');
  expect(s.published).toBe(true);
  expect(s.passwordHash).toBeUndefined();
  expect(s.passwordVersion).toBe(0);
});

test('setPublished persists and survives reload', async () => {
  await setPublished('nihongo', false);
  reloadSettings();
  expect(getAppSettings('nihongo').published).toBe(false);
});

test('setPassword stores a bcrypt hash, not the raw password, and bumps version', async () => {
  await setPassword('nihongo', 'hunter2');
  const s = getAppSettings('nihongo');
  expect(s.passwordHash).toBeDefined();
  expect(s.passwordHash).not.toContain('hunter2');
  expect(await Bun.password.verify('hunter2', s.passwordHash!)).toBe(true);
  expect(s.passwordVersion).toBe(1);
});

test('changing password bumps version again', async () => {
  await setPassword('nihongo', 'one');
  await setPassword('nihongo', 'two');
  expect(getAppSettings('nihongo').passwordVersion).toBe(2);
});

test('clearPassword removes the hash and bumps version', async () => {
  await setPassword('nihongo', 'one');
  await clearPassword('nihongo');
  const s = getAppSettings('nihongo');
  expect(s.passwordHash).toBeUndefined();
  expect(s.passwordVersion).toBe(2);
});

test('getSecret generates a stable hex secret and persists it', () => {
  const a = getSecret();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  reloadSettings();
  expect(getSecret()).toBe(a);
});

test('setOverride persists and getOverride/getAppSettings surface it', () => {
  setOverride('boxscore', { devPort: 5173, basePort: 8787 });
  expect(getOverride('boxscore')).toEqual({ devPort: 5173, basePort: 8787 });
  expect(getAppSettings('boxscore').override).toEqual({
    devPort: 5173,
    basePort: 8787,
  });
});

test('clearOverride removes it', () => {
  setOverride('boxscore', { devPort: 5173, basePort: 8787 });
  clearOverride('boxscore');
  expect(getOverride('boxscore')).toBeUndefined();
  expect(getAppSettings('boxscore').override).toBeUndefined();
});

test('getOverrides lists only apps with an active override', () => {
  setOverride('boxscore', { devPort: 5173, basePort: 8787 });
  expect(getOverrides()).toEqual({
    boxscore: { devPort: 5173, basePort: 8787 },
  });
});

// ─── deck.apps store migration (MAT-384 Task 2) ──────────────────────────────

test('deck.apps store value wins over settings.json, per field', () => {
  writeLegacyFile({
    version: 1,
    apps: {
      nihongo: {
        published: false,
        passwordVersion: 0,
        publicFollowsOverride: false,
      },
    },
  });
  setSetting(
    'deck.apps',
    { nihongo: { published: true, publicFollowsOverride: true } },
    'user'
  );
  reloadSettings();
  const s = getAppSettings('nihongo');
  expect(s.published).toBe(true);
  expect(s.publicFollowsOverride).toBe(true);
});

test('passwordHash/passwordVersion/override stay file-local: the store never carries them', () => {
  writeLegacyFile({
    version: 1,
    apps: {
      nihongo: { published: true, passwordHash: 'h', passwordVersion: 3 },
    },
  });
  setSetting('deck.apps', { nihongo: { published: false } }, 'user');
  reloadSettings();
  const s = getAppSettings('nihongo');
  expect(s.published).toBe(false);
  expect(s.passwordHash).toBe('h');
  expect(s.passwordVersion).toBe(3);
});

test('a resolver throw fails closed: every app reads unpublished, warning once, and the file-only fields stay', () => {
  writeLegacyFile({
    version: 1,
    apps: { nihongo: { passwordHash: 'h', passwordVersion: 3 } },
  });
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  const throwingResolver: typeof getSetting = () => {
    throw new Error('rt daemon unreachable');
  };
  reloadSettings(throwingResolver);
  expect(getAppSettings('nihongo').published).toBe(false);
  expect(getAppSettings('never-seen').published).toBe(false);
  expect(getAppSettings('nihongo').passwordHash).toBe('h');
  expect(getAppSettings('nihongo').passwordVersion).toBe(3);
  expect(warnSpy).toHaveBeenCalledTimes(1);
  warnSpy.mockRestore();
});

test('setPublicFollowsOverride keeps the field only in the store', () => {
  setPublicFollowsOverride('nihongo', true);

  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps.nihongo).not.toHaveProperty('publicFollowsOverride');
  expect(
    getSetting<Record<string, { publicFollowsOverride?: boolean }>>('deck.apps')
      .value.nihongo?.publicFollowsOverride
  ).toBe(true);
});

test('store key present: setPublished writes the store and stops persisting published to the file', async () => {
  setSetting(
    'deck.apps',
    { nihongo: { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  await setPublished('nihongo', false);
  const stored =
    getSetting<Record<string, { published?: boolean }>>('deck.apps').value;
  expect(stored?.nihongo?.published).toBe(false);

  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps.nihongo).not.toHaveProperty('published');
});

test('store key present: setPublicFollowsOverride writes the store and stops persisting the field to the file', () => {
  setSetting(
    'deck.apps',
    { nihongo: { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  setPublicFollowsOverride('nihongo', true);
  const stored =
    getSetting<Record<string, { publicFollowsOverride?: boolean }>>(
      'deck.apps'
    ).value;
  expect(stored?.nihongo?.publicFollowsOverride).toBe(true);

  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps.nihongo).not.toHaveProperty('publicFollowsOverride');
});

test('store key present: a setPassword-triggered save keeps the store current for every app, not just the touched one', async () => {
  setSetting(
    'deck.apps',
    { nihongo: { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  await setPublished('nihongo', false);
  await setPassword('nihongo', 'hunter2');
  const stored =
    getSetting<Record<string, { published?: boolean }>>('deck.apps').value;
  expect(stored?.nihongo?.published).toBe(false);
});

test('passwordVersion survives a write; the file never carries the store fields', async () => {
  setSetting(
    'deck.apps',
    { nihongo: { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  await setPassword('nihongo', 'one');
  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps.nihongo.passwordVersion).toBe(1);
  expect(onDisk.apps.nihongo).not.toHaveProperty('published');
});

test("store key present: a save for one app leaves a concurrently-written app's raw store entry untouched", async () => {
  setSetting(
    'deck.apps',
    { 'existing-app': { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings(); // boots knowing only about existing-app

  // Simulate a second process writing a brand new app to the store after
  // this process already booted -- this process's cache never learns about it.
  setSetting(
    'deck.apps',
    {
      'existing-app': { published: true, publicFollowsOverride: false },
      'concurrent-app': { published: false, publicFollowsOverride: true },
    },
    'user'
  );

  await setPublished('existing-app', false); // this process's own, unrelated save
  const stored = getSetting<Record<string, unknown>>('deck.apps').value;
  expect(stored?.['concurrent-app']).toEqual({
    published: false,
    publicFollowsOverride: true,
  });
  expect(stored?.['existing-app']).toEqual({
    published: false,
    publicFollowsOverride: false,
  });
});

test('an app known only through the store gets no empty-object entry in the file', () => {
  setSetting(
    'deck.apps',
    { 'store-only': { published: false, publicFollowsOverride: true } },
    'user'
  );
  reloadSettings();
  expect(getAppSettings('store-only').published).toBe(false);
  expect(getAppSettings('store-only').publicFollowsOverride).toBe(true);

  setPublicFollowsOverride('store-only', true); // triggers a save; no other file-local data exists for this app
  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps).not.toHaveProperty('store-only');
});

test('settings.json is written 0600', async () => {
  await setPublished('nihongo', true);
  const mode = statSync(process.env.LOCAL_APPS_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('an existing 0644 settings.json is upgraded to 0600 on the next write', async () => {
  writeLegacyFile({ version: 1, apps: {} });
  chmodSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 0o644);
  await setPublished('nihongo', true);
  const mode = statSync(process.env.LOCAL_APPS_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('store key present: a store write failure reverts the in-memory cache instead of claiming a value neither side holds', async () => {
  // rt-client's read path honest-degrades a malformed store to "empty"
  // rather than throwing (see stores.ts), so a plain syntax error can no
  // longer be used to force a write-time throw -- it would just read back as
  // unowned. A duplicate top-level key is the one shape that both (a) parses
  // fine under the lenient reader the ownership check uses (last occurrence
  // wins, so deck.apps reads as present/owned) and (b) is refused by
  // setSetting's stricter writer (assertEditableJsonc refuses to edit a
  // document with ANY duplicate key, anywhere in the tree).
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(
    userStorePath(),
    '{ "deck.apps": { "nihongo": { "published": true, "publicFollowsOverride": false } },' +
      ' "deck.apps": { "nihongo": { "published": true, "publicFollowsOverride": false } } }'
  );
  reloadSettings();
  const before = getAppSettings('nihongo').published;
  expect(before).toBe(true); // sanity: the store is read as owned before the write attempt

  await expect(setPublished('nihongo', false)).rejects.toThrow();
  expect(getAppSettings('nihongo').published).toBe(before);
});

test('store key present: a file-write failure after a successful store write restores the store to its previous value (renameAppSettings)', async () => {
  setSetting(
    'deck.apps',
    { 'old-name': { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();
  await setPassword('old-name', 'hunter2'); // gives old-name a passwordHash the rename must carry
  const storeBefore = getSetting<Record<string, unknown>>('deck.apps').value;

  // LOCAL_APPS_SETTINGS_PATH is fixed for the whole file (only HOME varies
  // per test), so turn it into a directory for this one test and clean it
  // back up afterward -- otherwise every later test's beforeEach (which
  // writes THAT path as a plain file) breaks. A rename onto an existing
  // directory fails (EISDIR), which is what makes the file-write step fail
  // AFTER the store write above it already succeeded.
  const settingsFilePath = process.env.LOCAL_APPS_SETTINGS_PATH!;
  rmSync(settingsFilePath, { force: true });
  mkdirSync(settingsFilePath, { recursive: true });
  try {
    expect(() => renameAppSettings('old-name', 'new-name')).toThrow();
  } finally {
    rmSync(settingsFilePath, { recursive: true, force: true });
  }

  const storeAfter = getSetting<Record<string, unknown>>('deck.apps').value;
  expect(storeAfter).toEqual(storeBefore);
  expect(getAppSettings('new-name').passwordHash).toBeUndefined();
  expect(getAppSettings('old-name').passwordHash).toBeDefined();
});

test("store key present: a file-write failure's store revert overlays the current raw store instead of replacing it wholesale", async () => {
  setSetting(
    'deck.apps',
    { 'old-name': { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings(); // boots knowing only about old-name

  // A second process adds a brand-new app to the store after this process's
  // cache was built -- the revert must not erase it.
  setSetting(
    'deck.apps',
    {
      'old-name': { published: true, publicFollowsOverride: false },
      'concurrent-app': { published: false, publicFollowsOverride: true },
    },
    'user'
  );

  const settingsFilePath = process.env.LOCAL_APPS_SETTINGS_PATH!;
  rmSync(settingsFilePath, { force: true });
  mkdirSync(settingsFilePath, { recursive: true });
  try {
    await expect(setPublished('old-name', false)).rejects.toThrow();
  } finally {
    rmSync(settingsFilePath, { recursive: true, force: true });
  }

  const stored = getSetting<Record<string, unknown>>('deck.apps').value;
  expect(stored?.['concurrent-app']).toEqual({
    published: false,
    publicFollowsOverride: true,
  });
  expect(stored?.['old-name']).toEqual({
    published: true,
    publicFollowsOverride: false,
  });
});

test('store key present: renameAppSettings carries published/publicFollowsOverride to the new key in the store', () => {
  setSetting(
    'deck.apps',
    { 'old-name': { published: false, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  setPublicFollowsOverride('old-name', true);
  renameAppSettings('old-name', 'new-name');
  const stored =
    getSetting<
      Record<string, { published?: boolean; publicFollowsOverride?: boolean }>
    >('deck.apps').value;
  expect(stored?.['old-name']).toBeUndefined();
  expect(stored?.['new-name']?.publicFollowsOverride).toBe(true);
  expect(getPublicFollowsOverride('new-name')).toBe(true);
});

const LIVE = {
  source: '/tmp/wt/console-runs-3',
  branch: 'console-runs-3',
  startedAt: '2026-10-09T21:12:00.000Z',
  uiPort: 11140,
};

test('setLive persists and survives reload', () => {
  setLive('chat', LIVE);
  reloadSettings();
  expect(getLive('chat')).toEqual(LIVE);
  expect(getLives()).toEqual({ chat: LIVE });
});

test('clearLive removes it and leaves the rest of the entry', async () => {
  await setPublished('chat', false);
  setLive('chat', LIVE);
  clearLive('chat');
  expect(getLive('chat')).toBeUndefined();
  expect(getAppSettings('chat').published).toBe(false);
});

test('live stays file-local: the store never carries it', () => {
  setSetting('deck.apps', { chat: { published: true } }, 'user');
  reloadSettings();
  setLive('chat', LIVE);
  const store =
    getSetting<Record<string, Record<string, unknown>>>('deck.apps').value!;
  expect(store.chat).not.toHaveProperty('live');
  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps.chat.live).toEqual(LIVE);
});

test('store key present: every deck.apps write passes validateWrite', async () => {
  setSetting(
    'deck.apps',
    { 'acme-app': { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  await setPublished('acme-app', false);
  await setPassword('acme-app', 'correct horse');
  setOverride('acme-app', { devPort: 5173, basePort: 4100 });
  setPublicFollowsOverride('acme-app', true);
  clearOverride('acme-app');
  renameAppSettings('acme-app', 'acme-web');
  await clearPassword('acme-web');

  const stored = getSetting('deck.apps').value;
  expect(
    validateWrite(getDef('deck.apps')!, stored, { scope: 'user' })
  ).toEqual({ ok: true });
});

// ─── one-time copy out of settings.json ──────────────────────────────────────

const appsPath = () => process.env.LOCAL_APPS_SETTINGS_PATH!;

test('a private app in settings.json moves into deck.apps before the first read; the file keeps the rest', () => {
  writeFileSync(
    appsPath(),
    JSON.stringify({
      version: 1,
      secret: 's',
      apps: { widgets: { published: false, passwordVersion: 2 } },
    })
  );
  expect(importFileFields()).toEqual({});
  expect(getSetting('deck.apps').value).toEqual({
    widgets: { published: false },
  });
  expect(JSON.parse(readFileSync(appsPath(), 'utf8'))).toEqual({
    version: 1,
    secret: 's',
    apps: { widgets: { passwordVersion: 2 } },
  });
  reloadSettings();
  expect(getAppSettings('widgets').published).toBe(false);
});

test('the copy fills only the apps no store sets; a stored app keeps its stored value', () => {
  setSetting('deck.apps', { widgets: { published: true } }, 'user');
  writeFileSync(
    appsPath(),
    JSON.stringify({
      version: 1,
      apps: { widgets: { published: false }, gadgets: { published: false } },
    })
  );
  expect(importFileFields()).toEqual({});
  expect(getSetting('deck.apps').value).toEqual({
    widgets: { published: true },
    gadgets: { published: false },
  });
  expect(JSON.parse(readFileSync(appsPath(), 'utf8')).apps).toEqual({});
});
test('a failed copy keeps this start on the file values and leaves the file alone', () => {
  const body = JSON.stringify({
    version: 1,
    apps: { widgets: { published: false } },
  });
  writeFileSync(appsPath(), body);
  const failing = (() => {
    throw new Error('store locked');
  }) as typeof setSetting;
  const pending = importFileFields(explainSetting, failing);
  expect(pending).toEqual({ widgets: { published: false } });
  expect(readFileSync(appsPath(), 'utf8')).toBe(body);
});

test('a save keeps published only in the store', async () => {
  await setPublished('widgets', false);
  expect(getSetting('deck.apps').value).toMatchObject({
    widgets: { published: false },
  });
  expect(
    JSON.parse(readFileSync(appsPath(), 'utf8')).apps.widgets?.published
  ).toBeUndefined();
});

test('minting the secret on a fresh install writes no settings store', () => {
  rmSync(userStorePath(), { force: true });
  writeFileSync(appsPath(), JSON.stringify({ version: 1, apps: {} }));
  reloadSettings();
  expect(getSecret()).toMatch(/^[0-9a-f]{64}$/);
  expect(existsSync(userStorePath())).toBe(false);
});

test('after a failed copy, the boot read keeps a private app private', () => {
  writeFileSync(
    appsPath(),
    JSON.stringify({ version: 1, apps: { widgets: { published: false } } })
  );
  const failing = (() => {
    throw new Error('store locked');
  }) as typeof setSetting;
  const pending = importFileFields(explainSetting, failing);
  reloadSettings(getSetting, pending);
  expect(getAppSettings('widgets').published).toBe(false);
});

test('a deck.apps value the resolver refused is never overwritten; the file stays and overlays this boot', () => {
  seedUserStore('deck.apps', 'oops');
  const body = JSON.stringify({
    version: 1,
    apps: { widgets: { published: false } },
  });
  writeFileSync(appsPath(), body);
  const pending = importFileFields();
  expect(pending).toEqual({ widgets: { published: false } });
  expect(JSON.parse(readFileSync(userStorePath(), 'utf8'))['deck.apps']).toBe(
    'oops'
  );
  expect(readFileSync(appsPath(), 'utf8')).toBe(body);
  reloadSettings(getSetting, pending);
  expect(getAppSettings('widgets').published).toBe(false);
});

test('a store read that throws during a save reverts the change instead of half-applying it', () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  seedUserStore('deck.apps', { poison: '${repoRoot}' });
  reloadSettings();
  warnSpy.mockRestore();
  expect(() => setLive('chat', LIVE)).toThrow();
  expect(getLive('chat')).toBeUndefined();
});
