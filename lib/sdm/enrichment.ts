/**
 * Declarative enrichment overlay: labels, tiers and db defaults layered on
 * top of the resources the catalog scanner (scan.ts) found. The only source
 * is the team's `sdm.resources`, team-only because it names employer
 * resources. Loading never throws: a store rt cannot read means no labels.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripJsonc } from "../jsonc.ts";
import { rtDir } from "../rt-paths.ts";
import { onlyDefault, registryDefault } from "../settings/presence.ts";
import { getSetting, type Resolved } from "../settings/resolve.ts";
import type { Value } from "../settings/registry-schemas.ts";
import * as out from "../ui/out.ts";
import { warn } from "../ui/warn.ts";

export type EnrichmentEntry = Value<"sdm.resources">[string];
export type CarrierNames = Record<string, { label: string }>;

function read<T>(key: string, title: string): Resolved<T> {
  try {
    return getSetting<T>(key);
  } catch (err) {
    const message = (err as Error).message;
    warn("sdm", `ignoring "${key}" -- ${message}`, {
      show: { title, hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return { value: registryDefault<T>(key), provenance: [] };
  }
}

/** Nothing reads the pre-store labels file; only a team owner can move it, so a member is told how. */
function noticeLegacyFile(): void {
  const path = join(rtDir(), "sdm", "enrichment.jsonc");
  if (!existsSync(path)) return;
  let value: string | null;
  try {
    value = JSON.stringify(JSON.parse(stripJsonc(readFileSync(path, "utf8"))));
  } catch {
    value = null;
  }
  const title = "Your old StrongDM labels file is no longer read";
  warn("sdm", `the old labels file ${path} is no longer read`, {
    context: { path },
    show:
      value === null
        ? { title, hint: "rt could not read it either" }
        : { title, hint: "your team's owner can copy it into your team's settings", next: out.cmd(`rt settings set sdm.resources '${value.replaceAll("'", "'\\''")}' --scope team`) },
  });
}

export function loadCarriers(): CarrierNames {
  return read<CarrierNames>("sdm.carriers", "Your sdm carrier names are being ignored").value;
}

export function loadEnrichment(): Record<string, EnrichmentEntry> {
  const resolved = read<Record<string, EnrichmentEntry>>("sdm.resources", "Your sdm enrichment setting is being ignored");
  if (onlyDefault(resolved)) noticeLegacyFile();
  return resolved.value;
}
