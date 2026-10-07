/**
 * Connection builder: joins the scanner's real StrongDM resources
 * (lib/sdm/scan.ts) with the user-maintained enrichment overlay
 * (lib/sdm/enrichment.ts) into the display rows the picker renders. A
 * resource with no enrichment entry still gets a row, with its tier,
 * carrier and label from its StrongDM tags, so browse never hides a real
 * resource behind a missing config mapping.
 */

import type { SdmResource } from "./scan.ts";
import type { CarrierNames, EnrichmentEntry } from "./enrichment.ts";

export interface SdmConnection {
  key: string;
  label: string;
  sdmResource: string;
  tier?: string;
  production?: boolean;
  reasonSuggestion?: string;
  db?: { database?: string; schema?: string; user?: string };
  /** Connectable without an access request (carried from the scan). */
  standingAccess?: boolean;
  carrier?: string;
  carrierTag?: string;
  env?: string;
  domain?: string;
  access?: string;
  /** No tenant tag: an older resource whose carrier, if any, came from its name. */
  legacy?: boolean;
  /** The label came from enrichment rather than the tags. */
  customLabel?: boolean;
}

const ENV_TIER: Record<string, string> = { dev: "development", prod: "production" };

export function tierFromEnv(env: string | undefined): string | undefined {
  if (env === undefined) return undefined;
  return Object.hasOwn(ENV_TIER, env) ? ENV_TIER[env] : env;
}

function tagMap(tags: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of tags) {
    const eq = tag.indexOf("=");
    if (eq > 0 && eq < tag.length - 1) map[tag.slice(0, eq)] = tag.slice(eq + 1);
  }
  return map;
}

export function carrierFromName(name: string, known: string[]): string | undefined {
  const padded = `-${name}-`;
  let best: string | undefined;
  let bestAt = -1;
  for (const tenant of known) {
    const at = padded.lastIndexOf(`-${tenant}-`);
    if (at < 0) continue;
    if (at > bestAt || (at === bestAt && tenant.length > (best?.length ?? 0))) {
      best = tenant;
      bestAt = at;
    }
  }
  return best;
}

function carrierLabel(tag: string, carriers: CarrierNames): string {
  return carriers[tag]?.label || tag.charAt(0).toUpperCase() + tag.slice(1);
}

export function buildSdmConnections(
  resources: SdmResource[],
  enrichment: Record<string, EnrichmentEntry>,
  carriers: CarrierNames = {},
): SdmConnection[] {
  const tagsOf = new Map(resources.map(r => [r.name, tagMap(r.tags)]));
  const known = [...new Set([...tagsOf.values()].map(t => t.tenant).filter((t): t is string => !!t))];
  return resources
    .map(r => {
      const e = enrichment[r.name];
      const tags = tagsOf.get(r.name)!;
      const carrierTag = tags.tenant ?? carrierFromName(r.name, known);
      const carrier = carrierTag === undefined ? undefined : carrierLabel(carrierTag, carriers);
      const built = carrier === undefined ? r.name : [carrier, tags.env, tags.domain, tags.access].filter(Boolean).join(" ");
      const label = e?.label || built;
      const tier = e?.tier || tierFromEnv(tags.env);
      return {
        key: `sdm:${r.name}`,
        label,
        sdmResource: r.name,
        tier,
        production: e?.production ?? tier === "production",
        reasonSuggestion: e?.reasonSuggestion ?? `investigating ${label} data`,
        db: e?.db,
        standingAccess: r.standingAccess,
        carrier,
        carrierTag,
        env: tags.env,
        domain: tags.domain,
        access: tags.access,
        legacy: tags.tenant === undefined,
        customLabel: !!e?.label,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
