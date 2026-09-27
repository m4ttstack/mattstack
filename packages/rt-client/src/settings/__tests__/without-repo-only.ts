import { getDef, type SettingDef } from "../registry-machinery.ts";

/**
 * Clears `repoOnly` on live registry defs so a test can use a real
 * repo-scoped key to exercise the generic global-and-repo ladder. Returns the
 * restore function; getDef hands out the shared def objects, so a restore
 * that never runs leaks into every later test in the process.
 */
export function suspendRepoOnly(keys: readonly string[]): () => void {
  const prior = keys.map((key) => {
    const def = getDef(key) as SettingDef;
    const was = def.repoOnly;
    delete def.repoOnly;
    return { def, was };
  });
  return () => {
    for (const { def, was } of prior) {
      if (was === undefined) delete def.repoOnly;
      else def.repoOnly = was;
    }
  };
}
