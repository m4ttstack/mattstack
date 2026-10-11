import { getDef } from "./registry.ts";
import { getSetting, type Provenance, type ResolveOpts } from "./resolve.ts";

/** No store sets the value: every provenance row is the registry default, or there are none. */
export function onlyDefault(resolved: { provenance: readonly Provenance[] }): boolean {
  return resolved.provenance.every((p) => p.scope === "default");
}

/**
 * `getSetting` reads a registry default as a present value, so "has anyone
 * set this?" is asked here, never by testing the value against undefined.
 */
export function unwritten(key: string, opts: ResolveOpts = {}): boolean {
  return onlyDefault(getSetting(key, opts));
}

/**
 * For code that describes what a team or person chose: a registry default is
 * nobody's choice, so it reads as unset, and so does a key the resolver
 * cannot read.
 */
export function storedValue<T>(key: string, opts: ResolveOpts = {}): T | undefined {
  try {
    const resolved = getSetting<T>(key, opts);
    return onlyDefault(resolved) ? undefined : resolved.value;
  } catch {
    return undefined;
  }
}

/** A copy, so a caller may change it without changing the registry. */
export function registryDefault<T>(key: string): T {
  const def = getDef(key);
  if (!def) throw new Error(`unknown setting "${key}"`);
  return structuredClone(def.default) as T;
}
