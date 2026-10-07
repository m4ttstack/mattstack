import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";

export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

export type MarkerState = { kind: "none" } | { kind: "invalid"; why: string } | { kind: "org"; org: string };

/** An old clone may still carry a `role: "team"` marker with an `org` field; a marker of any other role is not an org clone. */
export function markerState(p: Pick<Probes, "readFile">, dir: string): MarkerState {
  const raw = p.readFile(join(dir, ORG_MARKER_REL));
  if (raw === null) return { kind: "none" };
  let marker: unknown;
  try {
    marker = JSON.parse(stripJsonc(raw));
  } catch {
    return { kind: "invalid", why: "it is not valid JSON" };
  }
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return { kind: "invalid", why: "it is not a JSON object" };
  const { role, org } = marker as Record<string, unknown>;
  if (role !== "org" && role !== "team") return { kind: "none" };
  if (typeof org !== "string") return { kind: "invalid", why: "it names no org" };
  try {
    validateSlug(org);
  } catch {
    return { kind: "invalid", why: `${JSON.stringify(org)} is not a valid org name` };
  }
  return { kind: "org", org };
}

export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null {
  const state = markerState(p, dir);
  return state.kind === "org" ? state.org : null;
}
