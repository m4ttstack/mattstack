/**
 * Builds the picker's option list: Recent group first (top item preselected
 * by position), then one group per environment and carrier, each row showing
 * domain, access and resource. A connection shown in Recent is promoted out
 * of its group, so every connection appears exactly once (no confusing
 * duplicate rows when filtering).
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

const MAX_RECENT_ROWS = 3;

// Distinct from every access tone, so a live tunnel reads as its own state.
const CONNECTED_TONE = "blue";

const ACCESS_ORDER = ["read", "reader", "write", "admin"];
const ACCESS_TONE: Record<string, string> = { write: "peach", admin: "coral" };

const tierLabel = (tier: string) => TIER_LABELS[tier] ?? tier;

function header(c: SdmConnection): string {
  if (!c.tier) return "Other";
  return c.carrier ? `${tierLabel(c.tier)} · ${c.carrier}` : tierLabel(c.tier);
}

function tierRank(tier: string | undefined): number {
  if (!tier) return Number.MAX_SAFE_INTEGER;
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? TIER_ORDER.length : i;
}

function compareGroups(a: SdmConnection, b: SdmConnection): number {
  return tierRank(a.tier) - tierRank(b.tier)
    || (a.tier ?? "").localeCompare(b.tier ?? "")
    || Number(a.carrier === undefined) - Number(b.carrier === undefined)
    || (a.carrier ?? "").localeCompare(b.carrier ?? "");
}

function accessRank(access: string | undefined): number {
  const i = access === undefined ? -1 : ACCESS_ORDER.indexOf(access);
  return i === -1 ? ACCESS_ORDER.length : i;
}

function compareRows(a: SdmConnection, b: SdmConnection): number {
  return Number(a.domain !== "core") - Number(b.domain !== "core")
    || Number(a.domain === undefined) - Number(b.domain === undefined)
    || (a.domain ?? "").localeCompare(b.domain ?? "")
    || accessRank(a.access) - accessRank(b.access)
    || Number(a.legacy ?? false) - Number(b.legacy ?? false)
    || a.label.localeCompare(b.label);
}

function firstColumn(c: SdmConnection): string {
  return c.customLabel || !c.domain ? c.label : c.domain;
}

function matchText(c: SdmConnection): string {
  return [c.customLabel || !c.domain ? c.label : undefined, c.carrier, c.tier ? tierLabel(c.tier) : undefined, c.env, c.domain, c.access, c.sdmResource]
    .filter(Boolean).join(" ");
}

/**
 * Left gutter marks connection state at a glance: a filled dot = a live tunnel
 * right now, a check = standing access (connect with no access request),
 * blank = on-demand (connecting will prompt for an access request).
 */
function gutter(connected: boolean, standingAccess: boolean): string {
  return connected ? "● " : standingAccess ? "✓ " : "  ";
}

interface Widths { access: number; resource: number }

function cellsFor(c: SdmConnection, w: Widths): NonNullable<NavOption["cells"]> {
  const access = c.access ?? "";
  const tone = ACCESS_TONE[access];
  const cells: NonNullable<NavOption["cells"]> = [];
  if (w.access > 0) cells.push({ text: access.padEnd(w.access), ...(tone ? { tone, bold: true } : {}) });
  cells.push({ text: c.sdmResource.padEnd(w.resource), tone: "dim" });
  if (c.legacy && c.carrier) cells.push({ text: "old", tone: "faint" });
  return cells;
}

function row(c: SdmConnection, first: string, live: boolean, w: Widths): NavOption {
  return {
    value: c.key,
    label: `${gutter(live, c.standingAccess ?? false)}${first}`,
    cells: cellsFor(c, w),
    match: matchText(c),
    ...(live ? { tone: CONNECTED_TONE } : {}),
  };
}

export function buildPickerOptions(
  connections: SdmConnection[],
  recents: RecentEntry[],
  connectedResources: Set<string> = new Set(),
): NavOption[] {
  const options: NavOption[] = [];
  const isLive = (sdmResource: string) => connectedResources.has(sdmResource);
  const widths: Widths = {
    access: Math.max(0, ...connections.map(c => (c.access ?? "").length)),
    resource: Math.max(0, ...connections.map(c => c.sdmResource.length)),
  };

  // A connection's stable identity is its sdmResource, not its key: recents
  // recorded under older models carry stale keys/labels for the same resource.
  const byResource = new Map(connections.map(c => [c.sdmResource, c]));

  const recentRows = recents.slice(0, MAX_RECENT_ROWS);
  const recentResources = new Set(recentRows.map(r => r.sdmResource));
  if (recentRows.length > 0) {
    options.push(navSeparator("Recent"));
    for (const r of recentRows) {
      const cur = byResource.get(r.sdmResource);
      if (!cur) {
        options.push({ value: r.key, label: `${gutter(isLive(r.sdmResource), false)}${r.label}`, hint: r.tier ? `${r.sdmResource}  ${r.tier}` : r.sdmResource });
        continue;
      }
      const lead = cur.carrier && cur.tier ? `${cur.carrier} ${tierLabel(cur.tier)}` : undefined;
      const first = cur.customLabel || !lead ? firstColumn(cur) : `${lead}  ${firstColumn(cur)}`;
      options.push(row(cur, first, isLive(cur.sdmResource), widths));
    }
  }

  const rest = connections.filter(c => !recentResources.has(c.sdmResource));
  const groups = new Map<string, SdmConnection[]>();
  for (const c of [...rest].sort((a, b) => compareGroups(a, b) || compareRows(a, b))) {
    const h = header(c);
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h)!.push(c);
  }
  for (const [h, group] of groups) {
    options.push(navSeparator(h));
    for (const c of group) options.push(row(c, firstColumn(c), isLive(c.sdmResource), widths));
  }
  return options;
}
