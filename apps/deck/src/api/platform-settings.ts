import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { isDeepStrictEqual } from 'util';

import {
  getDef,
  getSetting,
  setSetting,
  unsetSetting,
} from '@mattstack/rt-client';
import { stateDir } from './state.ts';
import { defaultExplain, heldEntries, type ExplainFn } from './store-import.ts';

export interface TunnelIdentity {
  name: string;
  uuid: string;
}

export interface PlatformSettings {
  publicDomain: string | null;
  tlds: string[];
  legacyPrefixes: string[];
  secrets: { cfApiToken?: string; cfZoneId?: string };
  railway: { projectId: string; environmentId: string } | null;
  tunnel: TunnelIdentity | null;
}

const FILE_DEFAULTS: Pick<PlatformSettings, 'tlds' | 'secrets'> = {
  tlds: ['localhost'],
  secrets: {},
};

const STORE_KEY = 'deck.platform';
type StoreFields = Pick<
  PlatformSettings,
  'publicDomain' | 'legacyPrefixes' | 'railway' | 'tunnel'
>;
const STORE_FIELDS = [
  'publicDomain',
  'legacyPrefixes',
  'railway',
  'tunnel',
] as const;
type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

export function platformSettingsPath(): string {
  return (
    process.env.LOCAL_PLATFORM_SETTINGS_PATH ??
    join(stateDir(), 'platform.json')
  );
}

function readFile(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(platformSettingsPath(), 'utf8')
    );
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** platform.json keeps tlds and secrets; the store fields live in deck.platform. */
function writeFile(values: Record<string, unknown>): void {
  const {
    publicDomain: _a,
    legacyPrefixes: _b,
    railway: _c,
    tunnel: _d,
    ...kept
  } = values;
  const path = platformSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(kept, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function storeFieldsOf(values: PlatformSettings): StoreFields {
  return {
    publicDomain: values.publicDomain,
    legacyPrefixes: values.legacyPrefixes,
    railway: values.railway,
    tunnel: values.tunnel,
  };
}

/** Same one-time copy as core/settings.ts's importFileFields, per field instead of per app. */
export function importFileFields(
  explain: ExplainFn = defaultExplain,
  write: SetSettingFn = setSetting
): Partial<StoreFields> {
  const file = readFile();
  const fields = Object.fromEntries(
    STORE_FIELDS.filter(f => file[f] !== undefined).map(f => [f, file[f]])
  ) as Partial<StoreFields>;
  if (Object.keys(fields).length === 0) return {};
  let missing: Partial<StoreFields> = fields;
  try {
    const stored = heldEntries(STORE_KEY, 'machine', explain);
    if (stored.refused) {
      console.error(
        `deck: ${STORE_KEY} holds a value rt refused; using platform.json until it is fixed`
      );
      return fields;
    }
    missing = Object.fromEntries(
      Object.entries(fields).filter(([f]) => !stored.held.has(f))
    ) as Partial<StoreFields>;
    if (Object.keys(missing).length > 0)
      write(STORE_KEY, { ...stored.own, ...missing }, 'machine');
    writeFile(file);
    return {};
  } catch (err) {
    console.error(
      `deck: could not move platform settings into ${STORE_KEY}; using platform.json until the next start`,
      err
    );
    return missing;
  }
}

let storeUnreadable = false;

function readStoredPlatform(resolve: GetSettingFn): StoreFields {
  try {
    storeUnreadable = heldEntries(STORE_KEY, 'machine', defaultExplain).refused;
    if (storeUnreadable)
      console.warn(
        `deck: ${STORE_KEY} holds a value rt refused, using its defaults`
      );
    return resolve<StoreFields>(STORE_KEY).value as StoreFields;
  } catch (err) {
    storeUnreadable = true;
    console.warn(`deck: ${STORE_KEY} unavailable, using its defaults`, err);
    return structuredClone(getDef(STORE_KEY)!.default) as StoreFields;
  }
}

function load(
  resolve: GetSettingFn,
  pending: Partial<StoreFields> = {}
): PlatformSettings {
  const {
    publicDomain: _a,
    legacyPrefixes: _b,
    railway: _c,
    tunnel: _d,
    ...fileOnly
  } = readFile();
  return {
    ...FILE_DEFAULTS,
    ...fileOnly,
    ...readStoredPlatform(resolve),
    ...pending,
  } as PlatformSettings;
}

let cache: PlatformSettings = load(getSetting, importFileFields());

/** `pending` is what a failed boot import returned, for a reload that stands in for boot. */
export function reloadPlatformSettings(
  resolve: GetSettingFn = getSetting,
  pending: Partial<StoreFields> = {}
): void {
  cache = load(resolve, pending);
}
export function getPlatformSettings(): PlatformSettings {
  return cache;
}

/**
 * The store fields go to deck.platform (only when they differ from what the
 * store holds), the rest to platform.json. Writing replaces deck.platform wholesale from this process's
 * view, as any boot-read config in deck does; a restart picks up an outside
 * edit.
 */
export function updatePlatformSettings(patch: Partial<PlatformSettings>): void {
  if (storeUnreadable)
    throw new Error(
      `deck: ${STORE_KEY} could not be read at the last load; restart deck before changing platform settings`
    );
  const previous = cache;
  cache = {
    ...cache,
    ...patch,
    secrets: { ...cache.secrets, ...(patch.secrets ?? {}) },
  };
  let stored: StoreFields;
  let ownBefore: { present: boolean; value?: unknown };
  let storeChanged: boolean;
  try {
    const ownRow = defaultExplain(STORE_KEY).find(r => r.scope === 'machine');
    ownBefore = ownRow?.present
      ? { present: true, value: ownRow.authored ?? ownRow.value }
      : { present: false };
    stored = storeFieldsOf(
      getSetting<PlatformSettings>(STORE_KEY).value as PlatformSettings
    );
    storeChanged = !isDeepStrictEqual(storeFieldsOf(cache), stored);
    if (storeChanged) setSetting(STORE_KEY, storeFieldsOf(cache), 'machine');
  } catch (err) {
    cache = previous;
    throw err;
  }
  try {
    writeFile(cache as unknown as Record<string, unknown>);
  } catch (err) {
    if (storeChanged) {
      try {
        if (ownBefore.present)
          setSetting(STORE_KEY, ownBefore.value, 'machine');
        else unsetSetting(STORE_KEY, 'machine');
      } catch (revertErr) {
        console.error(
          'platform settings save: failed to revert deck.platform after a file-write failure',
          revertErr
        );
      }
    }
    cache = previous;
    throw err;
  }
}

/**
 * Secrets never transit API responses. CF credentials come from the rt
 * daemon now (src/edge/rt-secrets.ts), not this field -- so this strips
 * `secrets` without reading its contents at all, rather than reporting
 * booleans derived from it.
 */
export function redactedSettings() {
  const { secrets: _secrets, ...rest } = cache;
  return rest;
}
