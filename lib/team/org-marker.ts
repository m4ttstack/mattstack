import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";

export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

/** The pointer on `main` naming the data branch. Read before ORG_MARKER_REL, which an org moved before this file existed still keeps on `main`. */
export const POINTER_REL = ".mattstack.jsonc";

/** The words the data branch's README and the pointer's header both carry. */
export const DATA_BRANCH_WARNING = "This branch holds the org's data. Never delete it or merge it into main.";

/** The pointer file's text: a header saying what the data branch is, then the marker. */
export function pointerText(org: string, dataBranch: string, layout: number = ORG_LAYOUT): string {
  return `// mattstack: the org's data lives on the ${dataBranch} branch, not here.\n// ${DATA_BRANCH_WARNING.replace("This branch", `The ${dataBranch} branch`)}\n${JSON.stringify({ role: "org", org, layout, dataBranch }, null, 2)}\n`;
}

/** The highest org layout this rt reads. Moves only with a breaking change to the org repo's shape or to the shared settings' shape, never with a release. */
export const ORG_LAYOUT = 4;

/** Layouts this rt reads. 3 and 4 share every path; 4 only adds the data branch. */
export const READABLE_LAYOUTS: readonly number[] = [3, 4];

/** What a `role: "org"` marker without `layout` reads as. Fixed, never ORG_LAYOUT: a bump must not turn an unconverted repo ready. */
export const ORG_LAYOUT_ABSENT_DEFAULT = 2;

export type MarkerState = { kind: "none" } | { kind: "invalid"; why: string } | { kind: "org"; org: string; layout: number; dataBranch: string | null };

/** A plain branch name: no leading dash or slash, no trailing slash, no "..", no spaces. */
const BRANCH_RE = /^(?![-/])(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._/-]+$/;

/** Git's per-component rules: non-empty, no leading ".", no trailing "." or ".lock". */
export const validBranch = (name: string): boolean => BRANCH_RE.test(name) && name.split("/").every((c) => c !== "" && !c.startsWith(".") && !c.endsWith(".") && !c.endsWith(".lock"));

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
  const { role, org, layout, dataBranch } = marker as Record<string, unknown>;
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
  if (dataBranch !== undefined && (typeof dataBranch !== "string" || !validBranch(dataBranch))) {
    return { kind: "invalid", why: "its dataBranch is not a plain branch name" };
  }
  return { kind: "org", org, dataBranch: typeof dataBranch === "string" ? dataBranch : null, layout: typeof layout === "number" ? layout : role === "org" ? ORG_LAYOUT_ABSENT_DEFAULT : 1 };
}

/** A copy on `main` may hold only the root pointer, a copy on the data branch only the folder marker. */
export function markerState(p: Pick<Probes, "readFile">, dir: string): MarkerState {
  return parseMarker(p.readFile(join(dir, POINTER_REL)) ?? p.readFile(join(dir, ORG_MARKER_REL)));
}

export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null {
  const state = markerState(p, dir);
  return state.kind === "org" ? state.org : null;
}
