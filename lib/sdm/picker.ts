/**
 * Builds the picker's option list: Recent group first (top item preselected
 * by position), then tier groups in canonical order. A connection shown in
 * Recent is promoted out of its tier group, so every connection appears
 * exactly once (no confusing duplicate rows when filtering).
 */

import { navSeparator, type NavOption } from "../navigate.ts";
import type { SdmConnection } from "./browse.ts";
import type { RecentEntry } from "./state.ts";

export const TIER_LABELS: Record<string, string> = {
  development: "Development",
  qa: "QA",
  staging: "Staging",
  production: "Production",
};

const TIER_ORDER = ["development", "qa", "staging", "production"];

const TIER_TONE: Record<string, string> = {
  development: "mint",
  qa: "pink",
  staging: "peach",
  production: "coral",
};

const MAX_RECENT_ROWS = 3;

// Distinct from every tier tone, so a live tunnel reads as its own state.
const CONNECTED_TONE = "blue";

/**
 * Left gutter marks connection state at a glance: a filled dot = a live tunnel
 * right now, a check = standing access (connect with no access request),
 * blank = on-demand (connecting will prompt for an access request). Kept as
 * plain text so the picker's column alignment stays correct; the row's tone
 * carries the state.
 */
function row(
  key: string, label: string, sdmResource: string, tier: string | undefined,
  connected: boolean, standingAccess: boolean,
): NavOption {
  const gutter = connected ? "● " : standingAccess ? "✓ " : "  ";
  return {
    value: key,
    label: `${gutter}${label}`,
    hint: tier ? `${sdmResource}  ${tier}` : sdmResource,
    tone: connected ? CONNECTED_TONE : (tier ? TIER_TONE[tier] : undefined),
  };
}

export function buildPickerOptions(
  connections: SdmConnection[],
  recents: RecentEntry[],
  connectedResources: Set<string> = new Set(),
): NavOption[] {
  const options: NavOption[] = [];
  const isLive = (sdmResource: string) => connectedResources.has(sdmResource);

  // A connection's stable identity is its sdmResource, not its key: recents
  // recorded under older models carry stale keys/labels for the same resource,
  // so dedup by resource and render each recent from the CURRENT catalog entry
  // (fresh label/tier/key) when the resource is still reachable.
  const byResource = new Map(connections.map(c => [c.sdmResource, c]));

  const recentRows = recents.slice(0, MAX_RECENT_ROWS);
  const recentResources = new Set(recentRows.map(r => r.sdmResource));
  if (recentRows.length > 0) {
    options.push(navSeparator("Recent"));
    for (const r of recentRows) {
      const cur = byResource.get(r.sdmResource);
      if (cur) options.push(row(cur.key, cur.label, cur.sdmResource, cur.tier, isLive(cur.sdmResource), cur.standingAccess ?? false));
      else options.push(row(r.key, r.label, r.sdmResource, r.tier, isLive(r.sdmResource), false));
    }
  }

  // Skip connections already shown under Recent so they aren't listed twice.
  const byTier = new Map<string, SdmConnection[]>();
  for (const c of connections) {
    if (recentResources.has(c.sdmResource)) continue;
    const tier = c.tier ?? "";
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(c);
  }
  const tiers = [...byTier.keys()].sort((a, b) => {
    const ia = TIER_ORDER.indexOf(a);
    const ib = TIER_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? TIER_ORDER.length : ia) - (ib === -1 ? TIER_ORDER.length : ib);
    return a.localeCompare(b);
  });

  for (const tier of tiers) {
    options.push(navSeparator(tier === "" ? "Other" : (TIER_LABELS[tier] ?? tier)));
    const group = byTier.get(tier)!.slice().sort((a, b) => a.label.localeCompare(b.label));
    for (const c of group) options.push(row(c.key, c.label, c.sdmResource, c.tier, isLive(c.sdmResource), c.standingAccess ?? false));
  }

  return options;
}
