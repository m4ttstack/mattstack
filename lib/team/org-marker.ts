import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";

/** The highest org layout this rt reads. Moves only with a breaking change to the org repo's shape, never with a release. */
export const ORG_LAYOUT = 1;

export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

export type MarkerState = { kind: "none" } | { kind: "invalid"; why: string } | { kind: "org"; org: string; layout: number };

/** A marker without a `layout` field reads 2 for the org layout and 1 for the one-team layout, so no repo has to write the field to be recognised. */
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
  return { kind: "org", org, layout: typeof layout === "number" ? layout : role === "org" ? 2 : 1 };
}

export function markerState(p: Pick<Probes, "readFile">, dir: string): MarkerState {
  return parseMarker(p.readFile(join(dir, ORG_MARKER_REL)));
}

const MARKER_SHOW_TIMEOUT_MS = 15_000;

/** The org layout at `ref`, when it is one this rt does not read. A tip with no marker, a marker rt cannot parse, or a layout at or below ORG_LAYOUT passes. */
export async function layoutGate(exec: Probes["exec"], repoDir: string, ref: string): Promise<{ layout: number } | null> {
  const shown = await exec(["git", "-C", repoDir, "show", `${ref}:${ORG_MARKER_REL}`], { timeoutMs: MARKER_SHOW_TIMEOUT_MS, env: { LC_ALL: "C" } });
  if (shown.code !== 0) {
    if (/does not exist|exists on disk, but not in/i.test(shown.stderr)) return null;
    throw new Error(shown.stderr.trim() || `git show exited ${shown.code}`);
  }
  const marker = parseMarker(shown.stdout);
  return marker.kind === "org" && marker.layout > ORG_LAYOUT ? { layout: marker.layout } : null;
}

export function updateSentence(layout: number): string {
  return `Your org uses layout ${layout} and this app reads up to ${ORG_LAYOUT}. Update the app.`;
}
