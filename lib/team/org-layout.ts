/**
 * What shape this Mac's org is in, for every reader that must agree on it:
 * the update steps, materialize, the skills verbs, the migrations and the
 * `org.layout` status row. A clone on a layout this rt does not read is a
 * waiting state, never a failure: the files on disk stay as they are until
 * the pull (or the app update) that resolves it.
 */
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { orgDirUnder, orgsDirUnder } from "../rt-paths.ts";
import type { Probes } from "../setup/probes.ts";
import { markerState, ORG_LAYOUT } from "./org-marker.ts";

export type OrgLayoutState =
  | { kind: "none" }
  | { kind: "ready"; slug: string }
  | { kind: "waiting"; slug: string; dir: string; layout: number };

export const WAITING_SENTENCE = "Your org has not moved to its new layout yet. rt finishes the move when it does.";

export function updateSentence(layout: number): string {
  return `Your org uses layout ${layout} and this app reads up to ${ORG_LAYOUT}. Update the app.`;
}

export function layoutSentence(state: Extract<OrgLayoutState, { kind: "waiting" }>): string {
  return state.layout > ORG_LAYOUT ? updateSentence(state.layout) : WAITING_SENTENCE;
}

export function orgLayoutWaitingError(state: Extract<OrgLayoutState, { kind: "waiting" }>): UserActionableError {
  return new UserActionableError("org-layout-waiting", layoutSentence(state));
}

/**
 * Classifies the clone currentOrg would pick: the first by name, among folders
 * with .git/config and an org-kind marker, that holds the org store. When none
 * holds a store, the first by name with an org-kind marker.
 */
export function orgLayoutState(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">): OrgLayoutState {
  const root = orgsDirUnder(p.home);
  let fallback: { slug: string; dir: string; layout: number } | null = null;
  for (const slug of [...p.readDir(root)].sort()) {
    const dir = orgDirUnder(p.home, slug);
    if (!p.exists(join(dir, ".git", "config"))) continue;
    const marker = markerState(p, dir);
    if (marker.kind !== "org") continue;
    if (!p.exists(join(dir, "mattstack", "org", "settings.org.jsonc"))) {
      fallback ??= { slug, dir, layout: marker.layout };
      continue;
    }
    if (marker.layout === ORG_LAYOUT) return { kind: "ready", slug };
    return { kind: "waiting", slug, dir, layout: marker.layout };
  }
  return fallback ? { kind: "waiting", ...fallback } : { kind: "none" };
}
