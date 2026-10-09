import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";

export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

/** The highest org layout this rt reads. Moves only with a breaking change to the org repo's shape, never with a release. */
export const ORG_LAYOUT = 2;

/** What a `role: "org"` marker without `layout` reads as. Fixed, never ORG_LAYOUT: a bump must not turn an unconverted repo ready. */
export const ORG_LAYOUT_ABSENT_DEFAULT = 2;

export type MarkerState = { kind: "none" } | { kind: "invalid"; why: string } | { kind: "org"; org: string; layout: number };

/**
 * An old clone may still carry a `role: "team"` marker with an `org` field; a
 * marker of any other role is not an org clone. `layout` is the marker's own
 * when present; else ORG_LAYOUT_ABSENT_DEFAULT for the org layout and 1 for
 * the one-team layout, so no repo converted before the field existed has to
 * write it.
 */
export function parseMarker(raw: string | null): MarkerState {
  if (raw === null) return { kind: "none" };
  let marker: unknown;
  try {
    marker = JSON.parse(stripJsonc(raw));
  } catch {
    return { kind: "invalid", why: "it is not valid JSON" };
  }
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return { kind: "invalid", why: "it is not a JSON object" };
  const { role, org, layout } = marker as Record<string, unknown>;
  if (role !== "org" && role !== "team") return { kind: "none" };
  if (typeof org !== "string") return { kind: "invalid", why: "it names no org" };
  try {
    validateSlug(org);
  } catch {
    return { kind: "invalid", why: `${JSON.stringify(org)} is not a valid org name` };
  }
  if (layout !== undefined && (typeof layout !== "number" || !Number.isInteger(layout) || layout < 1)) {
    return { kind: "invalid", why: "its layout is not a positive whole number" };
  }
  return { kind: "org", org, layout: typeof layout === "number" ? layout : role === "org" ? ORG_LAYOUT_ABSENT_DEFAULT : 1 };
}

export function markerState(p: Pick<Probes, "readFile">, dir: string): MarkerState {
  return parseMarker(p.readFile(join(dir, ORG_MARKER_REL)));
}

export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null {
  const state = markerState(p, dir);
  return state.kind === "org" ? state.org : null;
}
