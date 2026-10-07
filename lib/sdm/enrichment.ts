/**
 * Declarative enrichment overlay: labels, tiers, and db defaults layered on
 * top of resources the catalog scanner (scan.ts) already discovered.
 *
 * Ownership-latch port (wave 2, registry keys `sdm.resources`, then the
 * deprecated `rt.sdmEnrichment`, team-only scope — enrichment names employer resources and must never be settable in
 * a user or machine store): the first of those keys with a value
 * wins; none set means the store does not own the data, so the legacy
 * ~/.mattstack/rt/sdm/enrichment.jsonc file stays authoritative, same as
 * always. Once the team store owns the key it wins WHOLESALE (a name-keyed
 * map, not a field-bag — unlike rt.worktreeApp, there is no per-field
 * default to fall back through), and the file is never consulted. A probe
 * failure (thrown by getSetting, or a store value the registry's type check
 * refuses) counts as unowned plus one warning that never echoes the value.
 * Pure and additive either way: loading never mutates the file and never
 * throws, so a missing or corrupt file just means "no enrichment" rather
 * than a crash.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { rtDir } from "../rt-paths.ts";
import { join } from "node:path";
import { stripJsonc } from "../jsonc.ts";
import { getSetting } from "../settings/resolve.ts";
import * as out from "../ui/out.ts";
import { warn } from "../ui/warn.ts";
import type { Value } from "../settings/registry-schemas.ts";

export type EnrichmentEntry = Value<"sdm.resources">[string];
export type CarrierNames = Record<string, { label: string }>;

const ENRICHMENT_KEYS = ["sdm.resources", "rt.sdmEnrichment"] as const;

export function enrichmentPath(): string {
  return join(rtDir(), "sdm", "enrichment.jsonc");
}

// Re-exported for existing importers; the implementation moved to
// lib/jsonc.ts when the validate-farm overlay files needed a string-aware
// version (origin URLs contain `//`, which the old regex ate).
export { stripJsonc } from "../jsonc.ts";

function probeKey<T>(key: string, title: string): T | undefined {
  try {
    return getSetting<T>(key).value;
  } catch (err) {
    const message = (err as Error).message;
    warn("sdm", `ignoring "${key}" -- ${message}`, {
      show: { title, hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return undefined;
  }
}

/**
 * The ownership-latch probe: `undefined` means neither key is set and the
 * legacy file stays authoritative. `sdm.resources` outranks the deprecated
 * `rt.sdmEnrichment` for a team whose owner has not run the migration.
 * Exported so the `rt sdm enrichment init` scaffold verb can refuse to write
 * the file once the team store owns the data.
 */
export function probeEnrichmentStore(): Record<string, EnrichmentEntry> | undefined {
  for (const key of ENRICHMENT_KEYS) {
    const value = probeKey<Record<string, EnrichmentEntry>>(key, "Your sdm enrichment setting is being ignored");
    if (value !== undefined) return value;
  }
  return undefined;
}

export function loadCarriers(): CarrierNames {
  return probeKey<CarrierNames>("sdm.carriers", "Your sdm carrier names are being ignored") ?? {};
}

export function loadEnrichment(path = enrichmentPath()): Record<string, EnrichmentEntry> {
  const owned = probeEnrichmentStore();
  if (owned !== undefined) return owned;

  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(stripJsonc(raw));
  } catch (err) {
    if (existsSync(path)) {
      warn("sdm", `failed to parse ${path}, ignoring enrichment file: ${(err as Error).message}`, {
        context: { path },
        show: { title: "Your sdm enrichment file could not be read", hint: "rt is ignoring it" },
      });
    }
    return {};
  }
}
