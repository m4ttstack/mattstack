import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { isDeepStrictEqual } from 'util';

import { getDef, getSetting, setSetting } from '@mattstack/rt-client';
import { stateDir } from './state.ts';

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
    return JSON.parse(readFileSync(platformSettingsPath(), 'utf8')) as Record<
      string,
      unknown
    >;
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

/** Same one-time copy as core/settings.ts's importFileFields, for the four store fields. */
export function importFileFields(
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): Partial<StoreFields> {
  const file = readFile();
  const fields = Object.fromEntries(
    STORE_FIELDS.filter(f => file[f] !== undefined).map(f => [f, file[f]])
  ) as Partial<StoreFields>;
  if (Object.keys(fields).length === 0) return {};
  try {
    if (resolve(STORE_KEY).provenance.every(p => p.scope === 'default'))
      write(STORE_KEY, fields, 'machine');
    writeFile(file);
    return {};
  } catch (err) {
    console.error(
      `deck: could not move platform settings into ${STORE_KEY}; using platform.json until the next start`,
      err
    );
    return fields;
  }
}

function readStore(resolve: GetSettingFn): StoreFields {
  try {
    return resolve<StoreFields>(STORE_KEY).value as StoreFields;
  } catch (err) {
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
    ...readStore(resolve),
    ...pending,
  } as PlatformSettings;
}

let cache: PlatformSettings = load(getSetting, importFileFields());

export function reloadPlatformSettings(
  resolve: GetSettingFn = getSetting
): void {
  cache = load(resolve);
}
export function getPlatformSettings(): PlatformSettings {
  return cache;
}

/**
 * The store fields go to deck.platform (only when they changed), the rest to
 * platform.json. Writing replaces deck.platform wholesale from this process's
 * view, as any boot-read config in deck does; a restart picks up an outside
 * edit.
 */
export function updatePlatformSettings(patch: Partial<PlatformSettings>): void {
  const previous = cache;
  cache = {
    ...cache,
    ...patch,
    secrets: { ...cache.secrets, ...(patch.secrets ?? {}) },
  };
  const storeChanged = !isDeepStrictEqual(
    storeFieldsOf(cache),
    storeFieldsOf(previous)
  );
  if (storeChanged) {
    try {
      setSetting(STORE_KEY, storeFieldsOf(cache), 'machine');
    } catch (err) {
      cache = previous;
      throw err;
    }
  }
  try {
    writeFile(cache as unknown as Record<string, unknown>);
  } catch (err) {
    if (storeChanged) {
      try {
        setSetting(STORE_KEY, storeFieldsOf(previous), 'machine');
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
