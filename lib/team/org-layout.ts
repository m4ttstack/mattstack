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
import { markerState, ORG_LAYOUT, type MarkerState } from "./org-marker.ts";

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

export interface OrgCandidate {
  slug: string;
  /** The folder holds .git/config. */
  isClone: boolean;
  marker: MarkerState;
  /** The folder holds mattstack/org/settings.org.jsonc. */
  hasStore: boolean;
}

/**
 * The one clone every reader agrees on: among candidates (in the caller's
 * name order) that are clones with an org-kind marker, the first holding the
 * org store; when none holds one, the first org-kind clone.
 */
export function pickOrgClone(candidates: OrgCandidate[]): { slug: string; layout: number; hasStore: boolean } | null {
  let fallback: { slug: string; layout: number; hasStore: boolean } | null = null;
  for (const c of candidates) {
    if (!c.isClone || c.marker.kind !== "org") continue;
    if (c.hasStore) return { slug: c.slug, layout: c.marker.layout, hasStore: true };
    fallback ??= { slug: c.slug, layout: c.marker.layout, hasStore: false };
  }
  return fallback;
}

/** Classifies the clone pickOrgClone would pick. */
export function orgLayoutState(p: Pick<Probes, "readDir" | "readFile" | "exists" | "home">): OrgLayoutState {
  const root = orgsDirUnder(p.home);
  const candidates = [...p.readDir(root)].sort().map((slug): OrgCandidate => {
    const dir = orgDirUnder(p.home, slug);
    return {
      slug,
      isClone: p.exists(join(dir, ".git", "config")),
      marker: markerState(p, dir),
      hasStore: p.exists(join(dir, "mattstack", "org", "settings.org.jsonc")),
    };
  });
  const picked = pickOrgClone(candidates);
  if (!picked) return { kind: "none" };
  if (picked.hasStore && picked.layout === ORG_LAYOUT) return { kind: "ready", slug: picked.slug };
  return { kind: "waiting", slug: picked.slug, dir: orgDirUnder(p.home, picked.slug), layout: picked.layout };
}
