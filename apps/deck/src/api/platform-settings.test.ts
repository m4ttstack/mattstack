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
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { explainSetting, getSetting, setSetting } from '@mattstack/rt-client';

// rt-client doesn't export its machine-store path helper; this literal is
// duplicated from rt-client/src/settings/paths.ts#machineSettingsPath (which
// itself documents duplicating it from repo-tools/lib/rt-paths.ts) for the
// same reason: no dependency from here on rt-client's internals, only its
// public API. Change there first, mirror here.
function machineStorePath(): string {
  return join(
    process.env.HOME!,
    '.mattstack',
    'user',
    'local',
    'test-machine',
    'settings.local.jsonc'
  );
}

// The resolver picks the machine profile from ~/.mattstack/machine-key (falling
// back to the hostname slug), so the fixture pins the key the path above uses.
function pinMachineKey(): void {
  mkdirSync(join(process.env.HOME!, '.mattstack'), { recursive: true });
  writeFileSync(
    join(process.env.HOME!, '.mattstack', 'machine-key'),
    'test-machine\n'
  );
}

const dir = mkdtempSync(join(tmpdir(), 'local-psettings-'));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, 'platform.json');
const {
  getPlatformSettings,
  updatePlatformSettings,
  reloadPlatformSettings,
  redactedSettings,
  importFileFields,
} = await import('./platform-settings.ts');

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  home = mkdtempSync(join(tmpdir(), 'local-psettings-home-'));
  process.env.HOME = home;
  pinMachineKey();
  reloadPlatformSettings();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function writeLegacyFile(body: Record<string, unknown>): void {
  writeFileSync(
    process.env.LOCAL_PLATFORM_SETTINGS_PATH!,
    JSON.stringify(body)
  );
}

test("defaults are the stranger's defaults", () => {
  expect(getPlatformSettings()).toEqual({
    publicDomain: null,
    tlds: ['localhost'],
    legacyPrefixes: [],
    secrets: {},
    railway: null,
    tunnel: null,
  });
});

test('updates persist and merge', () => {
  updatePlatformSettings({
    publicDomain: 'example.dev',
    secrets: { cfApiToken: 'tok' },
  });
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe('example.dev');
  expect(getPlatformSettings().secrets.cfApiToken).toBe('tok');
});

test('redaction: the secrets field never transits, in any shape -- CF creds come from the rt daemon now', () => {
  updatePlatformSettings({ secrets: { cfApiToken: 'tok', cfZoneId: 'z1' } });
  const r = redactedSettings();
  expect(r).toEqual({
    publicDomain: null,
    tlds: ['localhost'],
    legacyPrefixes: [],
    railway: null,
    tunnel: null,
  });
  expect(JSON.stringify(r)).not.toContain('tok');
});

test("deck.platform's store value is what deck reads", () => {
  writeLegacyFile({
    publicDomain: 'file.example.dev',
    legacyPrefixes: ['/file-prefix'],
    tlds: ['localhost'],
    secrets: {},
  });
  setSetting(
    'deck.platform',
    { publicDomain: 'store.example.dev', legacyPrefixes: ['/store-prefix'] },
    'machine'
  );
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe('store.example.dev');
  expect(getPlatformSettings().legacyPrefixes).toEqual(['/store-prefix']);
});

test('updatePlatformSettings writes a patched migrated field to the store without clobbering the other', () => {
  setSetting(
    'deck.platform',
    { publicDomain: 'existing.example.dev', legacyPrefixes: ['/existing'] },
    'machine'
  );
  reloadPlatformSettings();
  updatePlatformSettings({ publicDomain: 'new.example.dev' });
  const stored = getSetting<{
    publicDomain?: string;
    legacyPrefixes?: string[];
  }>('deck.platform').value;
  expect(stored?.publicDomain).toBe('new.example.dev');
  expect(stored?.legacyPrefixes).toEqual(['/existing']);
});

test('platform.json never carries the store fields after a write', () => {
  setSetting(
    'deck.platform',
    { publicDomain: 'seed.example.dev', legacyPrefixes: [] },
    'machine'
  );
  reloadPlatformSettings();
  updatePlatformSettings({
    publicDomain: 'x.example.dev',
    legacyPrefixes: ['/y'],
    tlds: ['localhost', 'z'],
    secrets: { cfApiToken: 'tok' },
  });
  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk).not.toHaveProperty('publicDomain');
  expect(onDisk).not.toHaveProperty('legacyPrefixes');
  expect(onDisk.tlds).toEqual(['localhost', 'z']);
  expect(onDisk.secrets).toEqual({ cfApiToken: 'tok' });
});

test('a publicDomain write lands in the store', () => {
  updatePlatformSettings({ publicDomain: 'fresh.example.dev' });
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe('fresh.example.dev');
  expect(
    getSetting<{ publicDomain?: string }>('deck.platform').value.publicDomain
  ).toBe('fresh.example.dev');
});

test('platform.json is written 0600', () => {
  updatePlatformSettings({ tlds: ['localhost', 'example.dev'] });
  const mode = statSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('an existing 0644 platform.json is upgraded to 0600 on the next write', () => {
  writeLegacyFile({
    publicDomain: null,
    legacyPrefixes: [],
    tlds: ['localhost'],
    secrets: {},
  });
  chmodSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 0o644);
  updatePlatformSettings({ tlds: ['localhost', 'upgraded.dev'] });
  const mode = statSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('store key present: a file-write failure after a successful store write restores the store to its previous value', () => {
  setSetting(
    'deck.platform',
    { publicDomain: 'before.example.dev', legacyPrefixes: ['/before'] },
    'machine'
  );
  reloadPlatformSettings();

  // Force the file write to fail AFTER the store write above already landed.
  const platformPath = process.env.LOCAL_PLATFORM_SETTINGS_PATH!;
  rmSync(platformPath, { force: true });
  mkdirSync(platformPath, { recursive: true });
  try {
    expect(() =>
      updatePlatformSettings({ publicDomain: 'after.example.dev' })
    ).toThrow();
  } finally {
    rmSync(platformPath, { recursive: true, force: true });
  }

  const stored = getSetting<{
    publicDomain?: string;
    legacyPrefixes?: string[];
  }>('deck.platform').value;
  expect(stored?.publicDomain).toBe('before.example.dev');
  expect(stored?.legacyPrefixes).toEqual(['/before']);
});

test('store key present: a store write failure reverts the in-memory cache instead of claiming a value neither side holds', () => {
  // rt-client's read path honest-degrades malformed stores to "empty"
  // rather than throwing (see stores.ts), so a plain syntax error can no
  // longer be used to force a write-time throw -- it would just read back
  // as unowned. A duplicate top-level key is the one shape that both (a)
  // parses fine under the lenient reader the ownership check uses (last
  // occurrence wins, so deck.platform reads as present/owned) and (b) is
  // refused by setSetting's stricter writer (assertEditableJsonc refuses to
  // edit a document with ANY duplicate key, anywhere in the tree).
  writeLegacyFile({
    publicDomain: 'file.example.dev',
    legacyPrefixes: [],
    tlds: ['localhost'],
    secrets: {},
  });
  mkdirSync(dirname(machineStorePath()), { recursive: true });
  writeFileSync(
    machineStorePath(),
    '{ "deck.platform": { "publicDomain": "owned.example.dev", "legacyPrefixes": [] },' +
      ' "deck.platform": { "publicDomain": "owned.example.dev", "legacyPrefixes": [] } }'
  );
  reloadPlatformSettings();
  const before = getPlatformSettings().publicDomain;
  expect(before).toBe('owned.example.dev'); // sanity: the store is read as owned before the write attempt

  expect(() =>
    updatePlatformSettings({ publicDomain: 'should-not-apply.example.dev' })
  ).toThrow();
  expect(getPlatformSettings().publicDomain).toBe(before);
});

test('nothing set reads the old defaults: no domain, no prefixes, no railway, no tunnel, localhost only', () => {
  writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, '{}');
  reloadPlatformSettings();
  expect(getPlatformSettings()).toEqual({
    publicDomain: null,
    tlds: ['localhost'],
    legacyPrefixes: [],
    secrets: {},
    railway: null,
    tunnel: null,
  });
});

test('the four store fields move out of platform.json once; tlds and secrets stay', () => {
  writeFileSync(
    process.env.LOCAL_PLATFORM_SETTINGS_PATH!,
    JSON.stringify({
      publicDomain: 'apps.example.com',
      legacyPrefixes: ['old'],
      tlds: ['localhost', 'test'],
      secrets: { cfZoneId: 'z' },
    })
  );
  expect(importFileFields()).toEqual({});
  expect(getSetting('deck.platform').value).toEqual({
    publicDomain: 'apps.example.com',
    legacyPrefixes: ['old'],
    railway: null,
    tunnel: null,
  });
  expect(
    JSON.parse(readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 'utf8'))
  ).toEqual({ tlds: ['localhost', 'test'], secrets: { cfZoneId: 'z' } });
});

test('a tlds-only update writes the file and leaves the store alone', () => {
  rmSync(machineStorePath(), { force: true });
  reloadPlatformSettings();
  updatePlatformSettings({ tlds: ['localhost', 'test'] });
  expect(existsSync(machineStorePath())).toBe(false);
});

const failing = (() => {
  throw new Error('store locked');
}) as typeof setSetting;

test('after a failed copy, a tlds-only update moves the file-only fields into the store instead of stripping them', () => {
  writeLegacyFile({
    publicDomain: 'apps.example.com',
    tunnel: { name: 'n', uuid: 'u' },
    tlds: ['localhost'],
    secrets: {},
  });
  const pending = importFileFields(explainSetting, failing);
  reloadPlatformSettings(getSetting, pending);
  expect(getPlatformSettings().publicDomain).toBe('apps.example.com');
  updatePlatformSettings({ tlds: ['localhost', 'test'] });
  reloadPlatformSettings();
  expect(getPlatformSettings().publicDomain).toBe('apps.example.com');
  expect(getPlatformSettings().tunnel).toEqual({ name: 'n', uuid: 'u' });
});

test('the copy fills only the fields no store sets; a stored field keeps its stored value', () => {
  setSetting('deck.platform', { publicDomain: 'store.example.com' }, 'machine');
  writeLegacyFile({
    publicDomain: 'file.example.com',
    tunnel: { name: 'n', uuid: 'u' },
  });
  expect(importFileFields()).toEqual({});
  const stored = getSetting<{ publicDomain: string; tunnel: unknown }>(
    'deck.platform'
  ).value;
  expect(stored.publicDomain).toBe('store.example.com');
  expect(stored.tunnel).toEqual({ name: 'n', uuid: 'u' });
});

test('a deck.platform value the resolver refused is never overwritten; platform.json stays', () => {
  mkdirSync(dirname(machineStorePath()), { recursive: true });
  writeFileSync(
    machineStorePath(),
    JSON.stringify({ 'deck.platform': 'oops' })
  );
  const body = JSON.stringify({ publicDomain: 'apps.example.com' });
  writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, body);
  expect(importFileFields()).toEqual({ publicDomain: 'apps.example.com' });
  expect(
    JSON.parse(readFileSync(machineStorePath(), 'utf8'))['deck.platform']
  ).toBe('oops');
  expect(readFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 'utf8')).toBe(
    body
  );
});

test('a platform.json that is not an object reads as empty instead of crashing', () => {
  writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, 'null');
  expect(importFileFields()).toEqual({});
  reloadPlatformSettings();
  expect(getPlatformSettings().tlds).toEqual(['localhost']);
});
