import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";

export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

/** An old clone may still carry a `role: "team"` marker with an `org` field; any other marker is not an org clone. */
export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null {
  const raw = p.readFile(join(dir, ORG_MARKER_REL));
  if (raw === null) return null;
  let marker: unknown;
  try {
    marker = JSON.parse(stripJsonc(raw));
  } catch {
    return null;
  }
  if (!marker || typeof marker !== "object") return null;
  const { role, org } = marker as Record<string, unknown>;
  if ((role !== "org" && role !== "team") || typeof org !== "string") return null;
  try {
    validateSlug(org);
  } catch {
    return null;
  }
  return org;
}
