import { getDef, type getSetting } from '@mattstack/rt-client';

type GetSettingFn = typeof getSetting;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/** getSetting's answer with no store on disk: a test value over the
    registry default, merged the way the resolver layers a `deep` key. */
export function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T>(key: string) => {
    const def = getDef(key);
    const fallback = structuredClone(def?.default);
    const stored = values[key];
    const value =
      stored === undefined
        ? fallback
        : def?.merge === 'deep'
          ? deepMerge(fallback, stored)
          : stored;
    const provenance =
      stored !== undefined
        ? [{ scope: 'team', file: '/fake/settings.team.jsonc' }]
        : fallback !== undefined
          ? [{ scope: 'default', file: null }]
          : [];
    return { value: value as T, provenance };
  }) as GetSettingFn;
}
