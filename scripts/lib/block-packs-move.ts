import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { stripJsonc } from "../../lib/jsonc.ts";
import { FragmentError, parseFragment } from "../../lib/skills/manifest-merge.ts";
import { findOldSlotKeys } from "../../lib/skills/old-slots.ts";
import { ORG_MARKER_REL, POINTER_REL, parseMarker } from "../../lib/team/org-marker.ts";
import { shellQuote } from "../../lib/team/org-branch.ts";
import { teamPackRel } from "../../lib/team/team-pack-path.ts";
import { markerWithLayout } from "./move-team-packs.ts";
import { ConversionRefusal, DATA_LAYOUT, assertNoLink, cloneRoot, linkRefusal } from "./org-conversion.ts";

export const BLOCK_PACKS_LAYOUT = 5;
const ORG_PACKS_REL = "mattstack/org/packs";
const TEAMS_REL = "mattstack/teams";
const FRAGMENT_REL = "pack/skills.jsonc";

export class BlockPacksRefusal extends ConversionRefusal {}

/** `alreadyMoved`: the marker is on layout 5, so the run only checks the packs. */
export type BlockPacksPlan = { cloneDir: string; org: string; branch: string; markerPath: string; alreadyMoved: boolean; packs: { name: string; ok: boolean; oldBindings: string[] }[] };

const SYMLINK_MODE = "120000";
const segments = (rel: string): string[] => rel.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/**
 * Every org pack and every team pack HEAD holds, base or not; a folder without
 * a fragment is not a pack. Read from HEAD rather than the working tree, which
 * a sparse cone can leave short of a team folder; preflight's clean-tree check
 * makes the two the same at write time. Org packs are named "org <folder>" so
 * one cannot share a name with a team.
 */
function packsInHead(git: (...argv: string[]) => string): { name: string; path: string }[] {
  const entries = git("ls-tree", "-r", "-t", "-z", "--full-tree", "HEAD", "--", "mattstack")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, type] = entry.slice(0, tab).split(" ");
      return { mode: mode!, type: type!, path: entry.slice(tab + 1) };
    });
  const blobs = new Set(entries.filter((e) => e.type === "blob" && e.mode !== SYMLINK_MODE).map((e) => e.path));
  const links = new Set(entries.filter((e) => e.mode === SYMLINK_MODE).map((e) => e.path));
  const linked = (rel: string): boolean => segments(rel).some((seg) => links.has(seg));
  if (linked(ORG_PACKS_REL) || linked(TEAMS_REL)) throw linkRefusal();
  const namesUnder = (root: string): string[] => [...new Set(entries.flatMap((e) => (e.path.startsWith(`${root}/`) ? [e.path.slice(root.length + 1).split("/")[0]!] : [])))].sort();
  const org = namesUnder(ORG_PACKS_REL).map((name) => ({ name: `org ${name}`, rel: `${ORG_PACKS_REL}/${name}` }));
  const teams = namesUnder(TEAMS_REL).map((team) => ({ name: team, rel: teamPackRel(team) }));
  return [...org, ...teams].flatMap(({ name, rel }) => {
    const path = `${rel}/${FRAGMENT_REL}`;
    if (linked(path)) throw linkRefusal();
    return blobs.has(path) ? [{ name, path }] : [];
  });
}

function checkMarker(clone: string, markerPath: string, admin: string | undefined): { org: string; layout: number } {
  const quoted = shellQuote(clone);
  if (!existsSync(markerPath) && existsSync(join(clone, POINTER_REL))) {
    throw new BlockPacksRefusal("This branch holds only the org's pointer", "Switch to the branch that holds the org's data and the converted packs.");
  }
  const text = existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null;
  const marker = parseMarker(text);
  if (marker.kind === "invalid") throw new BlockPacksRefusal("This is not a mattstack org repo", `mattstack/mattstack.jsonc cannot be read: ${marker.why}.`);
  // parseMarker also reads an old role: "team" marker as an org; only role: "org" converts.
  if (marker.kind !== "org" || (JSON.parse(stripJsonc(text!)) as { role?: unknown }).role !== "org") {
    throw new BlockPacksRefusal("This is not a mattstack org repo", "mattstack/mattstack.jsonc does not say role: org.");
  }
  if (marker.layout > BLOCK_PACKS_LAYOUT) throw new BlockPacksRefusal("This org is already on block packs");
  if (marker.layout < DATA_LAYOUT) {
    throw new BlockPacksRefusal(
      `This org is on layout ${marker.layout}`,
      `Move it to layout ${DATA_LAYOUT} first, so its data lives on a data branch.`,
      marker.layout === 3 ? `bun scripts/move-to-data-branch.ts ${quoted} --admin ${admin === undefined ? "<username>" : shellQuote(admin)}` : undefined,
    );
  }
  if (marker.dataBranch === null) {
    throw new BlockPacksRefusal(
      "This org's marker names no data branch",
      `A layout ${marker.layout} marker says which branch holds the org's data. Find that branch on origin, add it to mattstack/mattstack.jsonc as dataBranch, publish that, then run this again.`,
      `git -C ${quoted} branch -r`,
    );
  }
  return { org: marker.org, layout: marker.layout };
}

export function planBlockPacksMove(cloneDir: string, admin?: string): BlockPacksPlan {
  const { path: clone, git } = cloneRoot(cloneDir);
  assertNoLink(clone, ORG_MARKER_REL);
  const markerPath = join(clone, ORG_MARKER_REL);
  const { org, layout } = checkMarker(clone, markerPath, admin);
  let branch: string;
  try {
    branch = git("symbolic-ref", "-q", "--short", "HEAD").trim();
  } catch {
    throw new BlockPacksRefusal("The clone has no branch checked out", "Check out the published trial branch that holds the converted packs.", `git -C ${shellQuote(clone)} switch <trial-branch>`);
  }
  const packs = packsInHead(git).map(({ name, path }) => {
    let fragment;
    try {
      fragment = parseFragment(git("show", `HEAD:${path}`), path);
    } catch (err) {
      if (err instanceof FragmentError) throw new BlockPacksRefusal(`The ${name} pack cannot be read`, `${err.message}. Fix it on this branch, publish it, then run this again.`);
      throw err;
    }
    const oldBindings = findOldSlotKeys(fragment).map((k) => `${k.key} ${k.slot}${k.pipeline === null ? "" : ` in pipeline ${k.pipeline}`}`);
    return { name, ok: oldBindings.length === 0, oldBindings };
  });
  return { cloneDir: clone, org, branch, markerPath, alreadyMoved: layout === BLOCK_PACKS_LAYOUT, packs };
}

/** Writes layout 5 to the marker and commits it on the checked-out branch; the caller has run preflight. */
export function applyBlockPacksMove(plan: BlockPacksPlan): void {
  const { git } = cloneRoot(plan.cloneDir);
  writeFileSync(plan.markerPath, markerWithLayout(readFileSync(plan.markerPath, "utf8"), BLOCK_PACKS_LAYOUT));
  git("add", "--", ORG_MARKER_REL);
  git("commit", "-q", "-m", `org: every pack is a block pack (layout ${BLOCK_PACKS_LAYOUT})`);
}
