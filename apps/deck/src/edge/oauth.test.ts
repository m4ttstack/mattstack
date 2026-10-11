// src/edge/oauth.test.ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { explainSetting, getSetting, setSetting } from '@mattstack/rt-client';

// rt-client doesn't export its user-store path helper; this literal is
// duplicated from rt-client/src/settings/paths.ts#userSettingsPath, same
// reason platform-settings.test.ts duplicates the machine one: no dependency
// from here on rt-client's internals, only its public API.
function userStorePath(): string {
  return join(process.env.HOME!, '.mattstack', 'user', 'settings.user.jsonc');
}

/** Writes a value straight into the user store, past rt-client's write
    gate, for tests that need a malformed value on disk. */
function seedUserStore(key: string, value: unknown): void {
  const path = userStorePath();
  mkdirSync(dirname(path), { recursive: true });
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    current = {};
  }
  writeFileSync(path, JSON.stringify({ ...current, [key]: value }, null, 2));
}

const dir = mkdtempSync(join(tmpdir(), 'local-oauth-'));
const ACCESS_PATH = join(dir, 'access.json');
// These are process-wide, and `bun test` runs every file in one process, so
// restore them afterwards rather than leaving this file's scratch paths for
// whatever sorts after it to inherit.
const priorState = process.env.LOCAL_STATE_DIR;
const priorAccess = process.env.LOCAL_ACCESS_PATH;
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_ACCESS_PATH = ACCESS_PATH;
const {
  parseOAuth,
  getOAuth,
  setOAuth,
  renameOAuth,
  reloadOAuth,
  oauthRequiresCf,
  importAccessFile,
  accessPath,
} = await import('./oauth.ts');

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  rmSync(ACCESS_PATH, { force: true });
  rmSync(`${ACCESS_PATH}.imported`, { force: true });
  home = mkdtempSync(join(tmpdir(), 'local-oauth-home-'));
  process.env.HOME = home;
  reloadOAuth();
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

afterAll(() => {
  restore('LOCAL_STATE_DIR', priorState);
  restore('LOCAL_ACCESS_PATH', priorAccess);
  rmSync(dir, { recursive: true, force: true });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('parseOAuth accepts each mode and rejects junk', () => {
  expect(parseOAuth({ mode: 'off' })).toEqual({ mode: 'off' });
  expect(
    parseOAuth({ mode: 'emails', emails: ['a@x.dev', 'b@x.dev'] })
  ).toEqual({ mode: 'emails', emails: ['a@x.dev', 'b@x.dev'] });
  expect(
    parseOAuth({ mode: 'domains', domains: ['corp.com', 'other.dev'] })
  ).toEqual({ mode: 'domains', domains: ['corp.com', 'other.dev'] });

  expect(parseOAuth({ mode: 'emails', emails: [] })).toHaveProperty('error');
  expect(
    parseOAuth({ mode: 'emails', emails: ['not-an-email'] })
  ).toHaveProperty('error');
  expect(parseOAuth({ mode: 'emails' })).toHaveProperty('error');
  expect(parseOAuth({ mode: 'domains', domains: [] })).toHaveProperty('error');
  expect(
    parseOAuth({ mode: 'domains', domains: ['not a domain'] })
  ).toHaveProperty('error');
  expect(parseOAuth({ mode: 'vip' })).toHaveProperty('error');
  expect(parseOAuth(null)).toHaveProperty('error');
});

test('parseOAuth rejects the old tier names rather than translating them', () => {
  expect(parseOAuth({ tier: 'public' })).toHaveProperty('error');
  expect(parseOAuth({ tier: 'password' })).toHaveProperty('error');
  expect(parseOAuth({ tier: 'only-me', email: 'm@x.dev' })).toHaveProperty(
    'error'
  );
  expect(
    parseOAuth({ tier: 'work-domain', emailDomain: 'corp.com' })
  ).toHaveProperty('error');
  expect(parseOAuth({ tier: 'custom', emails: ['a@x.dev'] })).toHaveProperty(
    'error'
  );
});

test('rules persist per app; the default is off', () => {
  expect(getOAuth('a')).toEqual({ mode: 'off' });
  setOAuth('a', { mode: 'domains', domains: ['corp.com'] });
  reloadOAuth();
  expect(getOAuth('a')).toEqual({ mode: 'domains', domains: ['corp.com'] });
});

test('only an on-mode needs Cloudflare', () => {
  expect(oauthRequiresCf({ mode: 'off' })).toBe(false);
  expect(oauthRequiresCf({ mode: 'emails', emails: ['m@x.dev'] })).toBe(true);
  expect(oauthRequiresCf({ mode: 'domains', domains: ['corp.com'] })).toBe(
    true
  );
});

// ─── deck.access store migration (MAT-384 Task 2) ────────────────────────────

test("a store entry that doesn't match the OAuth shape is skipped, never rewritten", () => {
  seedUserStore('deck.access', { a: { tier: 'public' } });
  reloadOAuth();
  expect(getOAuth('a')).toEqual({ mode: 'off' });
  // Never auto-rewrite the store: the malformed entry is still there verbatim.
  const stored = getSetting<Record<string, unknown>>('deck.access').value;
  expect(stored?.a).toEqual({ tier: 'public' });
});

test('setOAuth writes the store', () => {
  setSetting('deck.access', { seed: { mode: 'off' } }, 'user');
  reloadOAuth();

  setOAuth('a', { mode: 'emails', emails: ['a@x.dev'] });
  const stored = getSetting<Record<string, unknown>>('deck.access').value;
  expect(stored?.a).toEqual({ mode: 'emails', emails: ['a@x.dev'] });
  expect(stored?.seed).toEqual({ mode: 'off' });
});

test("store key present: setOAuth on one app keeps every other app's rule current in the store too", () => {
  setSetting('deck.access', { seed: { mode: 'off' } }, 'user');
  reloadOAuth();

  setOAuth('a', { mode: 'emails', emails: ['a@x.dev'] });
  setOAuth('b', { mode: 'domains', domains: ['corp.com'] });
  const stored = getSetting<Record<string, unknown>>('deck.access').value;
  expect(stored?.a).toEqual({ mode: 'emails', emails: ['a@x.dev'] });
  expect(stored?.b).toEqual({ mode: 'domains', domains: ['corp.com'] });
});

test('store key present: a malformed store entry for another app survives a write untouched', () => {
  // "a" is malformed (isOAuth rejects it): the loader skips it on READ, but
  // the WRITE overlay reads the raw store fresh, so it must never be erased
  // by a write that only touches "b".
  seedUserStore('deck.access', { a: { tier: 'public' }, b: { mode: 'off' } });
  reloadOAuth();

  setOAuth('b', { mode: 'emails', emails: ['b@x.dev'] });
  const stored = getSetting<Record<string, unknown>>('deck.access').value;
  expect(stored?.a).toEqual({ tier: 'public' });
  expect(stored?.b).toEqual({ mode: 'emails', emails: ['b@x.dev'] });
});

test('store key present: a store write failure reverts the in-memory cache instead of claiming a value neither side holds', () => {
  // rt-client's read path honest-degrades a malformed store to "empty"
  // rather than throwing (see stores.ts), so a plain syntax error can no
  // longer be used to force a write-time throw -- it would just read back as
  // unowned. A duplicate top-level key is the one shape that both (a) parses
  // fine under the lenient reader the ownership check uses (last occurrence
  // wins, so deck.access reads as present/owned) and (b) is refused by
  // setSetting's stricter writer (assertEditableJsonc refuses to edit a
  // document with ANY duplicate key, anywhere in the tree).
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(
    userStorePath(),
    '{ "deck.access": { "a": { "mode": "off" } }, "deck.access": { "a": { "mode": "off" } } }'
  );
  reloadOAuth();
  expect(getOAuth('a')).toEqual({ mode: 'off' }); // sanity: the store is read as owned before the write attempt

  expect(() =>
    setOAuth('a', { mode: 'emails', emails: ['a@x.dev'] })
  ).toThrow();
  expect(getOAuth('a')).toEqual({ mode: 'off' });
});

// ─── renameOAuth (adopt verb + edit-rename fix) ──────────────────────────────

test('renameOAuth moves the rule in the store and never writes access.json', () => {
  setOAuth('mrs', { mode: 'emails', emails: ['m@x.dev'] });
  renameOAuth('mrs', 'board');

  expect(getOAuth('board')).toEqual({ mode: 'emails', emails: ['m@x.dev'] });
  expect(getOAuth('mrs')).toEqual({ mode: 'off' });
  expect(getSetting<Record<string, unknown>>('deck.access').value).toEqual({
    board: { mode: 'emails', emails: ['m@x.dev'] },
  });
  expect(existsSync(ACCESS_PATH)).toBe(false);
});

test('store key present: renameOAuth drops the old key and writes the new one, other entries untouched', () => {
  seedUserStore('deck.access', {
    mrs: { mode: 'domains', domains: ['corp.com'] },
    other: { mode: 'off' },
    malformed: { tier: 'public' },
  });
  reloadOAuth();

  renameOAuth('mrs', 'board');

  const stored = getSetting<Record<string, unknown>>('deck.access').value!;
  expect(stored.mrs).toBeUndefined();
  expect(stored.board).toEqual({ mode: 'domains', domains: ['corp.com'] });
  expect(stored.other).toEqual({ mode: 'off' });
  expect(stored.malformed).toEqual({ tier: 'public' });
  expect(getOAuth('board')).toEqual({ mode: 'domains', domains: ['corp.com'] });
});

test('renameOAuth with no rule under the old name is a no-op — no write at all', () => {
  setOAuth('keeper', { mode: 'off' });
  const before = readFileSync(userStorePath(), 'utf8');

  renameOAuth('ghost', 'board');

  expect(readFileSync(userStorePath(), 'utf8')).toBe(before);
  expect(getOAuth('board')).toEqual({ mode: 'off' });
});

test('store key present: a store write failure during renameOAuth reverts the cache and rethrows', () => {
  mkdirSync(dirname(userStorePath()), { recursive: true });
  writeFileSync(
    userStorePath(),
    '{ "deck.access": { "mrs": { "mode": "off" } }, "deck.access": { "mrs": { "mode": "off" } } }'
  );
  reloadOAuth();
  expect(getOAuth('mrs')).toEqual({ mode: 'off' });

  expect(() => renameOAuth('mrs', 'board')).toThrow();
  expect(getOAuth('mrs')).toEqual({ mode: 'off' });
  expect(getOAuth('board')).toEqual({ mode: 'off' }); // default, not the moved rule
});

// ─── one-time copy out of access.json ────────────────────────────────────────

test('access.json moves into deck.access once, valid rules only, and is renamed', () => {
  writeFileSync(
    accessPath(),
    JSON.stringify({
      apps: {
        widgets: { mode: 'emails', emails: ['dev1@example.com'] },
        stale: { mode: 'nope' },
      },
    })
  );
  expect(importAccessFile()).toEqual({});
  expect(getSetting('deck.access').value).toEqual({
    widgets: { mode: 'emails', emails: ['dev1@example.com'] },
  });
  expect(existsSync(accessPath())).toBe(false);
  expect(existsSync(`${accessPath()}.imported`)).toBe(true);
});

test('a failed copy keeps this start on the file rules', () => {
  writeFileSync(
    accessPath(),
    JSON.stringify({
      apps: { widgets: { mode: 'domains', domains: ['example.com'] } },
    })
  );
  const failing = (() => {
    throw new Error('store locked');
  }) as typeof setSetting;
  expect(importAccessFile(explainSetting, failing)).toEqual({
    widgets: { mode: 'domains', domains: ['example.com'] },
  });
  expect(existsSync(accessPath())).toBe(true);
});

test('setOAuth writes the store and never access.json', () => {
  setOAuth('widgets', { mode: 'domains', domains: ['example.com'] });
  expect(getSetting('deck.access').value).toMatchObject({
    widgets: { mode: 'domains', domains: ['example.com'] },
  });
  expect(existsSync(accessPath())).toBe(false);
});

const failingWrite = (() => {
  throw new Error('store locked');
}) as typeof setSetting;

test('the copy fills only the apps no store sets; a stored rule keeps its stored value', () => {
  setSetting('deck.access', { gadgets: { mode: 'off' } }, 'user');
  writeFileSync(
    accessPath(),
    JSON.stringify({
      apps: {
        widgets: { mode: 'emails', emails: ['dev1@example.com'] },
        gadgets: { mode: 'domains', domains: ['example.com'] },
      },
    })
  );
  expect(importAccessFile()).toEqual({});
  expect(getSetting('deck.access').value).toEqual({
    gadgets: { mode: 'off' },
    widgets: { mode: 'emails', emails: ['dev1@example.com'] },
  });
  expect(existsSync(`${accessPath()}.imported`)).toBe(true);
});

test('after a failed copy, the boot read keeps the file rule, and a write for another app carries it into the store', () => {
  writeFileSync(
    accessPath(),
    JSON.stringify({
      apps: { widgets: { mode: 'domains', domains: ['example.com'] } },
    })
  );
  const pending = importAccessFile(explainSetting, failingWrite);
  reloadOAuth(getSetting, pending);
  expect(getOAuth('widgets')).toEqual({
    mode: 'domains',
    domains: ['example.com'],
  });
  setOAuth('gadgets', { mode: 'off' });
  expect(getSetting('deck.access').value).toEqual({
    widgets: { mode: 'domains', domains: ['example.com'] },
    gadgets: { mode: 'off' },
  });
});

test('a deck.access value the resolver refused is never overwritten; access.json stays', () => {
  seedUserStore('deck.access', 'oops');
  writeFileSync(
    accessPath(),
    JSON.stringify({
      apps: { widgets: { mode: 'domains', domains: ['example.com'] } },
    })
  );
  expect(importAccessFile()).toEqual({
    widgets: { mode: 'domains', domains: ['example.com'] },
  });
  expect(JSON.parse(readFileSync(userStorePath(), 'utf8'))['deck.access']).toBe(
    'oops'
  );
  expect(existsSync(accessPath())).toBe(true);
});

test('a store read that throws during renameOAuth reverts the rename', () => {
  seedUserStore('deck.access', { poison: '${repoRoot}' });
  const rule = { mode: 'domains' as const, domains: ['example.com'] };
  reloadOAuth(() => ({ value: {}, provenance: [] }) as never, { mrs: rule });
  expect(() => renameOAuth('mrs', 'board')).toThrow();
  expect(getOAuth('mrs')).toEqual(rule);
  expect(getOAuth('board')).toEqual({ mode: 'off' });
});
