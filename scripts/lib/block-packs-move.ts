import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { stripJsonc } from "../../lib/jsonc.ts";
import { FragmentError, parseFragment } from "../../lib/skills/manifest-merge.ts";
import { findOldSlotKeys } from "../../lib/skills/old-slots.ts";
import { ORG_MARKER_REL, POINTER_REL, parseMarker } from "../../lib/team/org-marker.ts";
import { shellQuote } from "../../lib/team/org-branch.ts";
import { teamPackRel } from "../../lib/team/team-pack-path.ts";
import { markerWithLayout } from "./move-team-packs.ts";
import { ConversionRefusal, assertNoLink, cloneRoot } from "./org-conversion.ts";

export const BLOCK_PACKS_LAYOUT = 5;
const DATA_LAYOUT = 4;
const ORG_PACKS_REL = "mattstack/org/packs";
const TEAMS_REL = "mattstack/teams";
const FRAGMENT_REL = "pack/skills.jsonc";

export class BlockPacksRefusal extends ConversionRefusal {}

export type BlockPacksPlan = { branch: string; markerPath: string; packs: { name: string; ok: boolean; oldBindings: string[] }[] };

const folders = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

/** Every org pack and every team pack the clone holds, base or not; a folder without a fragment is not a pack. */
function packFolders(clone: string): { name: string; rel: string }[] {
  const org = folders(join(clone, ORG_PACKS_REL)).map((name) => ({ name, rel: `${ORG_PACKS_REL}/${name}` }));
  const teams = folders(join(clone, TEAMS_REL)).map((team) => ({ name: team, rel: teamPackRel(team) }));
  return [...org, ...teams].filter(({ rel }) => existsSync(join(clone, rel, FRAGMENT_REL)));
}

function checkMarker(clone: string, markerPath: string): void {
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
  if (marker.layout >= BLOCK_PACKS_LAYOUT) throw new BlockPacksRefusal("This org is already on block packs");
  if (marker.layout < DATA_LAYOUT || marker.dataBranch === null) {
    throw new BlockPacksRefusal(
      `This org is on layout ${marker.layout}`,
      "Move it to layout 4 first, so its data lives on a data branch.",
      marker.layout === 3 ? `bun scripts/move-to-data-branch.ts ${shellQuote(clone)} --admin <username>` : undefined,
    );
  }
}

export function planBlockPacksMove(cloneDir: string): BlockPacksPlan {
  const { path: clone, git } = cloneRoot(cloneDir);
  assertNoLink(clone, ORG_MARKER_REL);
  const markerPath = join(clone, ORG_MARKER_REL);
  checkMarker(clone, markerPath);
  let branch: string;
  try {
    branch = git("symbolic-ref", "-q", "--short", "HEAD").trim();
  } catch {
    throw new BlockPacksRefusal("The clone has no branch checked out", "Check out the published trial branch that holds the converted packs.");
  }
  assertNoLink(clone, ORG_PACKS_REL);
  assertNoLink(clone, TEAMS_REL);
  const packs = packFolders(clone).map(({ name, rel }) => {
    assertNoLink(clone, `${rel}/${FRAGMENT_REL}`);
    const path = `${rel}/${FRAGMENT_REL}`;
    let fragment;
    try {
      fragment = parseFragment(readFileSync(join(clone, path), "utf8"), path);
    } catch (err) {
      if (err instanceof FragmentError) throw new BlockPacksRefusal(`The ${name} pack cannot be read`, `${err.message}. Fix it on this branch, publish it, then run this again.`);
      throw err;
    }
    const oldBindings = findOldSlotKeys(fragment).map((k) => `${k.key} ${k.slot}${k.pipeline === null ? "" : ` in pipeline ${k.pipeline}`}`);
    return { name, ok: oldBindings.length === 0, oldBindings };
  });
  return { branch, markerPath, packs };
}

/** Writes layout 5 to the marker and commits it on the checked-out branch; the caller has run preflight. */
export function applyBlockPacksMove(plan: BlockPacksPlan): void {
  const clone = plan.markerPath.slice(0, -ORG_MARKER_REL.length - 1);
  const { git } = cloneRoot(clone);
  writeFileSync(plan.markerPath, markerWithLayout(readFileSync(plan.markerPath, "utf8"), BLOCK_PACKS_LAYOUT));
  git("add", "--", ORG_MARKER_REL);
  git("commit", "-q", "-m", `org: every pack is a block pack (layout ${BLOCK_PACKS_LAYOUT})`);
}
