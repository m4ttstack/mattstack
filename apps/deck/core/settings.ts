import { randomBytes } from 'crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { isDeepStrictEqual } from 'util';

import { explainSetting, getSetting, setSetting } from '@mattstack/rt-client';
import { stateDir } from '../src/api/state.ts';
import { heldEntries, type ExplainFn } from '../src/api/store-import.ts';

export interface PortOverride {
  devPort: number;
  basePort: number;
}

export interface LiveState {
  /** Root of the checkout the app runs live from: the shared checkout or a worktree. */
  source: string;
  branch: string | null;
  startedAt: string;
  uiPort?: number;
  /** The branch a deleted worktree moved the app off, for the board's warning. */
  movedFrom?: string;
}

export interface AppSettings {
  published: boolean;
  passwordHash?: string;
  passwordVersion: number;
  override?: PortOverride;
  /**
   * Let public traffic follow an active dev-port override instead of pinning to
   * the app's base port. Off by default, and a sibling of `override` rather than
   * a field inside it so the preference survives clearing and re-setting one.
   * Only apps whose dev server accepts the public hostname should turn this on;
   * see preflight.ts.
   */
  publicFollowsOverride?: boolean;
}

interface AppEntry {
  published?: boolean;
  passwordHash?: string;
  passwordVersion?: number;
  override?: PortOverride;
  publicFollowsOverride?: boolean;
  live?: LiveState;
}

export interface SettingsFile {
  version: number;
  secret?: string;
  apps: Record<string, AppEntry>;
}

// Computed fresh on every call (not frozen at import time) so callers that set
// LOCAL_APPS_SETTINGS_PATH after this module first loads (tests, in particular)
// still get the override, regardless of module load order. Mirrors routesPath().
// boot-env.ts always sets LOCAL_APPS_SETTINGS_PATH before this module's own
// eager `cache = load()` runs, so the stateDir() fallback below is a second
// safety net for anything that imports this module without going through
// boot-env.ts first (a test, in particular) -- it must never fall through to
// the repo's own data/ directory, which is untracked scratch, not a config
// source.
export function settingsPath(): string {
  return (
    process.env.LOCAL_APPS_SETTINGS_PATH ?? join(stateDir(), 'settings.json')
  );
}

const STORE_KEY = 'deck.apps';
type StoreAppFields = { published: boolean; publicFollowsOverride: boolean };
type StoreApps = Record<string, Partial<StoreAppFields>>;
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** What settings.json keeps for an app: published and publicFollowsOverride live in deck.apps. */
function fileEntry(entry: AppEntry): AppEntry {
  const {
    published: _published,
    publicFollowsOverride: _follows,
    ...rest
  } = entry;
  return rest;
}

function readFile(): SettingsFile {
  try {
    const parsed = JSON.parse(
      readFileSync(settingsPath(), 'utf8')
    ) as SettingsFile;
    if (!parsed.apps) parsed.apps = {};
    return parsed;
  } catch {
    return { version: 1, apps: {} };
  }
}

function writeFile(state: SettingsFile): void {
  const apps: Record<string, AppEntry> = {};
  for (const [app, entry] of Object.entries(state.apps)) {
    const kept = fileEntry(entry);
    if (Object.keys(kept).length > 0) apps[app] = kept;
  }
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...state, apps }, null, 2), {
    mode: 0o600,
  });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/**
 * A deck that kept published and publicFollowsOverride in settings.json
 * copies them into deck.apps before its first read, so an app made private
 * never reads as public. The copy fills only the apps no store sets, and
 * leaves the file alone when a store holds a value the resolver refused.
 * When the copy cannot land, the returned fields overlay this boot and the
 * file is left for the next one.
 */
export function importFileFields(
  explain: ExplainFn = explainSetting,
  write: SetSettingFn = setSetting
): StoreApps {
  const file = readFile();
  const fields: StoreApps = {};
  for (const [app, entry] of Object.entries(file.apps)) {
    const picked: Partial<StoreAppFields> = {};
    if (entry.published !== undefined) picked.published = entry.published;
    if (entry.publicFollowsOverride !== undefined)
      picked.publicFollowsOverride = entry.publicFollowsOverride;
    if (Object.keys(picked).length > 0) fields[app] = picked;
  }
  if (Object.keys(fields).length === 0) return {};
  let missing: StoreApps = fields;
  try {
    const stored = heldEntries(STORE_KEY, 'user', explain);
    if (stored.refused) {
      console.error(
        `deck: ${STORE_KEY} holds a value rt refused; using settings.json until it is fixed`
      );
      return fields;
    }
    missing = Object.fromEntries(
      Object.entries(fields).filter(([app]) => !stored.held.has(app))
    );
    if (Object.keys(missing).length > 0)
      write(STORE_KEY, { ...stored.own, ...missing }, 'user');
    writeFile(file);
    return {};
  } catch (err) {
    console.error(
      `deck: could not move app publishing into ${STORE_KEY}; using settings.json until the next start`,
      err
    );
    return missing;
  }
}

/** Null when the store cannot be read or holds a value the resolver refused, which makes every app read unpublished. */
function readStore(resolve: GetSettingFn, explain: ExplainFn): StoreApps | null {
  try {
    if (heldEntries(STORE_KEY, 'user', explain).refused) {
      console.warn(
        `deck: ${STORE_KEY} holds a value rt refused, every app reads unpublished`
      );
      return null;
    }
    return resolve<StoreApps>(STORE_KEY).value as StoreApps;
  } catch (err) {
    console.warn(
      `deck: ${STORE_KEY} unavailable, every app reads unpublished`,
      err
    );
    return null;
  }
}

let storeUnreadable = false;

function load(
  resolve: GetSettingFn,
  pending: StoreApps = {},
  explain: ExplainFn = explainSetting
): SettingsFile {
  const file = readFile();
  const apps: Record<string, AppEntry> = {};
  for (const [app, entry] of Object.entries(file.apps))
    apps[app] = fileEntry(entry);
  const store = readStore(resolve, explain);
  storeUnreadable = store === null;
  for (const [app, fields] of Object.entries({ ...store, ...pending }))
    apps[app] = { ...apps[app], ...fields };
  return { ...file, apps };
}

let cache: SettingsFile = load(getSetting, importFileFields());
mintSecretIfMissing();

/** `pending` is what a failed boot import returned, for a reload that stands in for boot. */
export function reloadSettings(
  resolve: GetSettingFn = getSetting,
  pending: StoreApps = {},
  explain: ExplainFn = explainSetting
): void {
  cache = load(resolve, pending, explain);
  mintSecretIfMissing();
}

/** Minted at boot and on every reload, never on the request path. The secret is file-only, so minting never writes the store. */
function mintSecretIfMissing(): void {
  if (cache.secret) return;
  cache.secret = randomBytes(32).toString('hex');
  writeFile(cache);
}

/** The store's view of every app currently in cache, defaults applied so both fields are always determinate. */
function buildAppsStoreDict(
  state: SettingsFile
): Record<string, StoreAppFields> {
  const out: Record<string, StoreAppFields> = {};
  for (const [app, entry] of Object.entries(state.apps)) {
    out[app] = {
      published: entry.published ?? true,
      publicFollowsOverride: entry.publicFollowsOverride ?? false,
    };
  }
  return out;
}

function currentRawAppsStore(): StoreApps {
  return getSetting<StoreApps>(STORE_KEY).value as StoreApps;
}

/**
 * Overlays this process's known apps onto a FRESH read of the raw store,
 * never a wholesale replace built from cache alone: another process may have
 * written an app this process's boot-time cache never saw, and rebuilding
 * purely from cache would silently erase it. `previous.apps` keys missing
 * from the CURRENT cache -- a rename's old name -- are the one case an app
 * should actually disappear from the store, so those are deleted from the
 * result.
 */
function nextAppsStoreDict(previous: SettingsFile): StoreApps {
  const next: StoreApps = {
    ...currentRawAppsStore(),
    ...buildAppsStoreDict(cache),
  };
  for (const app of Object.keys(previous.apps)) {
    if (!(app in cache.apps)) delete next[app];
  }
  return next;
}

/**
 * The revert-direction mirror of nextAppsStoreDict, same overlay-a-fresh-read
 * reasoning: a wholesale replace from `previous` alone would erase whatever
 * the just-reverted forward write (or a concurrent process) landed in the
 * store for an unrelated app. `cache` keys missing from `previous.apps` -- a
 * rename's new name, just added by the forward write this call is undoing --
 * are the one case an app should disappear from the store on revert.
 */
function revertedAppsStoreDict(previous: SettingsFile): StoreApps {
  const reverted: StoreApps = {
    ...currentRawAppsStore(),
    ...buildAppsStoreDict(previous),
  };
  for (const app of Object.keys(cache.apps)) {
    if (!(app in previous.apps)) delete reverted[app];
  }
  return reverted;
}

/**
 * Every mutation funnels through here: the store fields go to deck.apps
 * (only when they changed), the rest to settings.json. A failure reverts
 * `cache` to `previous` and rethrows; a file failure after a store write
 * un-writes the store too, so a renamed app never keeps a store entry whose
 * password hash never reached disk.
 */
function save(previous: SettingsFile): void {
  let storeChanged: boolean;
  try {
    if (storeUnreadable)
      throw new Error(
        `deck: ${STORE_KEY} could not be read at the last load; restart deck before changing app settings`
      );
    const next = nextAppsStoreDict(previous);
    storeChanged = !isDeepStrictEqual(next, currentRawAppsStore());
    if (storeChanged) setSetting(STORE_KEY, next, 'user');
  } catch (err) {
    cache = previous;
    throw err;
  }
  try {
    writeFile(cache);
  } catch (err) {
    if (storeChanged) {
      try {
        setSetting(STORE_KEY, revertedAppsStoreDict(previous), 'user');
      } catch (revertErr) {
        console.error(
          'settings save: failed to revert deck.apps after a file-write failure',
          revertErr
        );
      }
    }
    cache = previous;
    console.error('settings save failed:', err);
    throw err;
  }
}

export function getAppSettings(app: string): AppSettings {
  const entry = cache.apps[app];
  return {
    published: storeUnreadable ? false : (entry?.published ?? true),
    passwordHash: entry?.passwordHash,
    passwordVersion: entry?.passwordVersion ?? 0,
    override: entry?.override,
    publicFollowsOverride: entry?.publicFollowsOverride ?? false,
  };
}

function ensure(app: string): AppEntry {
  if (!cache.apps[app])
    cache.apps[app] = { published: true, passwordVersion: 0 };
  return cache.apps[app] as AppEntry;
}

export function getSecret(): string {
  return cache.secret as string;
}

export async function setPublished(
  app: string,
  published: boolean
): Promise<void> {
  const previous = structuredClone(cache);
  ensure(app).published = published;
  save(previous);
}

export async function setPassword(
  app: string,
  password: string
): Promise<void> {
  const previous = structuredClone(cache);
  const entry = ensure(app);
  entry.passwordHash = await Bun.password.hash(password);
  entry.passwordVersion = (entry.passwordVersion ?? 0) + 1;
  save(previous);
}

export async function clearPassword(app: string): Promise<void> {
  const previous = structuredClone(cache);
  const entry = ensure(app);
  delete entry.passwordHash;
  entry.passwordVersion = (entry.passwordVersion ?? 0) + 1;
  save(previous);
}

/**
 * Move an app's whole settings entry to a new key, verbatim. Renaming a record
 * has to carry published/passwordHash/passwordVersion/override with it: an
 * unknown name defaults to published:true with no password, so without this a
 * rename would silently turn a private, password-protected app public. It moves
 * the raw entry because no setter above can: setPassword only takes a plaintext
 * to re-hash, and an existing hash has no plaintext to re-derive it from.
 * A no-op when the old name has no entry (nothing to carry). The store side
 * follows automatically: save()'s overlay
 * diffs `previous.apps` against the current cache, so the old key drops out
 * of the store and the new key picks up its fields.
 */
export function renameAppSettings(oldName: string, newName: string): void {
  const entry = cache.apps[oldName];
  if (!entry) return;
  const previous = structuredClone(cache);
  delete cache.apps[oldName];
  cache.apps[newName] = entry;
  save(previous);
}

export function getOverride(app: string): PortOverride | undefined {
  return cache.apps[app]?.override;
}

export function setOverride(app: string, override: PortOverride): void {
  const previous = structuredClone(cache);
  ensure(app).override = override;
  save(previous);
}

export function clearOverride(app: string): void {
  const entry = cache.apps[app];
  if (entry?.override) {
    const previous = structuredClone(cache);
    delete entry.override;
    save(previous);
  }
}

export function getPublicFollowsOverride(app: string): boolean {
  return cache.apps[app]?.publicFollowsOverride ?? false;
}

export function setPublicFollowsOverride(app: string, follows: boolean): void {
  const previous = structuredClone(cache);
  const entry = ensure(app);
  // Store the default as an absent key rather than `false`, so deck.apps
  // stays free of noise for the apps that never opt in.
  if (follows) entry.publicFollowsOverride = true;
  else delete entry.publicFollowsOverride;
  save(previous);
}

export function getOverrides(): Record<string, PortOverride> {
  const out: Record<string, PortOverride> = {};
  for (const [app, s] of Object.entries(cache.apps)) {
    if (s.override) out[app] = s.override;
  }
  return out;
}

export function getLive(app: string): LiveState | undefined {
  return cache.apps[app]?.live;
}

export function setLive(app: string, live: LiveState): void {
  const previous = structuredClone(cache);
  ensure(app).live = live;
  save(previous);
}

export function clearLive(app: string): void {
  const entry = cache.apps[app];
  if (entry?.live) {
    const previous = structuredClone(cache);
    delete entry.live;
    save(previous);
  }
}

export function getLives(): Record<string, LiveState> {
  const out: Record<string, LiveState> = {};
  for (const [app, s] of Object.entries(cache.apps)) {
    if (s.live) out[app] = s.live;
  }
  return out;
}
