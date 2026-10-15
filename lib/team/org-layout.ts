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
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import { markerState, ORG_LAYOUT, ORG_MARKER_REL, parseMarker, READABLE_LAYOUTS, type MarkerState } from "./org-marker.ts";

export type OrgLayoutState =
  | { kind: "none" }
  | { kind: "ready"; slug: string; layout: number }
  | { kind: "waiting"; slug: string; dir: string; layout: number };

export const WAITING_SENTENCE = "Your org has not moved to its new layout yet. rt finishes the move when it does.";

export function updateSentence(layout: number): string {
  return `Your org uses layout ${layout} and this app reads up to ${ORG_LAYOUT}. Update the app.`;
}

/** The `git show` argument that prints the org marker at `ref`. */
export function markerAtRef(ref: string): string {
  return `${ref}:${ORG_MARKER_REL}`;
}

/**
 * The layout a `git show <markerAtRef(ref)>` printed, when it is one this rt
 * does not read. A tip with no marker, a marker rt cannot parse, or a layout
 * at or below ORG_LAYOUT passes; any other git failure throws.
 */
export function layoutAbove(shown: { code: number; stdout: string; stderr: string }): { layout: number } | null {
  if (shown.code !== 0) {
    if (/does not exist|exists on disk, but not in|not in the index/i.test(shown.stderr)) return null;
    throw new Error(shown.stderr.trim() || `git show exited ${shown.code}`);
  }
  const marker = parseMarker(shown.stdout);
  return marker.kind === "org" && marker.layout > ORG_LAYOUT ? { layout: marker.layout } : null;
}

export type GateVerdict = { kind: "above"; layout: number } | { kind: "moved"; dataBranch: string };

/** Why a pull was held: the fetched tip is on a layout this rt does not read, or the org's data moved to another branch. */
export type PullHold = { layout: number; reads: number } | { moved: string };

export const MOVED_SENTENCE = (branch: string): string => `Your org's data moved to the ${branch} branch. rt switches this Mac over when your copy has no unsaved changes.`;

export function holdSentence(hold: PullHold): string {
  return "moved" in hold ? MOVED_SENTENCE(hold.moved) : updateSentence(hold.layout);
}

/** The data branch a `git show` of a marker names; null for a failed show, no marker, or one rt cannot parse. */
export function shownDataBranch(shown: { code: number; stdout: string; stderr: string }): string | null {
  if (shown.code !== 0) return null;
  const marker = parseMarker(shown.stdout);
  return marker.kind === "org" ? marker.dataBranch : null;
}

/**
 * Whether HEAD's tree holds the org store, which tells a data or trial branch
 * from `main`'s pointer: both carry a marker naming a data branch, only the
 * first holds the org. Null when git cannot say.
 */
export async function headHoldsOrgStore(exec: Probes["exec"], dir: string, timeoutMs?: number): Promise<boolean | null> {
  const listed = await exec(["git", "-C", dir, "ls-tree", "--name-only", "HEAD", "--", ORG_STORE_REL], { env: { LC_ALL: "C" }, ...(timeoutMs ? { timeoutMs } : {}) });
  if (listed.code !== 0) return null;
  return listed.stdout.trim() !== "";
}

/**
 * What a pull must do given the marker at the fetched tip, the branch this
 * clone has checked out, and the data branch its own (HEAD) marker names. Only
 * a clone whose own marker names no data branch moves: a trial branch made
 * from the data branch still names it, and must stay where it is.
 */
export function gateVerdict(shown: { code: number; stdout: string; stderr: string }, checkedOut: string, own: string | null): GateVerdict | null {
  const above = layoutAbove(shown);
  if (above) return { kind: "above", layout: above.layout };
  const named = shownDataBranch(shown);
  if (own === null && named !== null && named !== checkedOut) return { kind: "moved", dataBranch: named };
  return null;
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

/** A picked clone is ready only on a layout this rt reads and with its org store; every reader asks this one rule. */
export function pickedCloneReady(picked: { layout: number; hasStore: boolean }): boolean {
  return picked.hasStore && READABLE_LAYOUTS.includes(picked.layout);
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
  if (pickedCloneReady(picked)) return { kind: "ready", slug: picked.slug, layout: picked.layout };
  return { kind: "waiting", slug: picked.slug, dir: orgDirUnder(p.home, picked.slug), layout: picked.layout };
}
