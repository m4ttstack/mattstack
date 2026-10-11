/**
 * Attaches a JSON Schema to a live registry def for the duration of one
 * assertion. Defs are shared objects (`getDef` returns the live entry, the
 * `withTeamLocked` pattern in resolve.test.ts), so this must restore the
 * previous schema/layerSchema afterward or one test's schema would leak into
 * the next.
 */

import { getDef, type SettingDef } from "../registry-machinery.ts";
import { layerJsonSchema } from "../schema.ts";

export function withSchema(key: string, schema: Record<string, unknown>, fn: () => void): void {
  const def = getDef(key) as SettingDef;
  const prev = { schema: def.schema, layer: def.layerSchema };
  def.schema = schema;
  def.layerSchema = def.merge === "deep" && def.type === "object" ? layerJsonSchema(schema) : undefined;
  try {
    fn();
  } finally {
    def.schema = prev.schema;
    def.layerSchema = prev.layer;
  }
}

/** Runs `fn` with the def's registry default removed, so a test can exercise a
    merge that starts from nothing; restored afterward like `withSchema`. */
export function withoutDefault(key: string, fn: () => void): void {
  const def = getDef(key) as SettingDef;
  const had = "default" in def;
  const prev = def.default;
  delete def.default;
  try {
    fn();
  } finally {
    if (had) def.default = prev;
  }
}
