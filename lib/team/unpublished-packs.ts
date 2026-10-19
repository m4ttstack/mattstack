/**
 * Pack edits an org clone holds that `rt skills sync` has not published. The
 * snapshot engine never commits a pack zone on the branch, since its push
 * would publish to teammates; past the janitor threshold it saves the zone's
 * content to one local ref per zone instead. The engine, the
 * `org.unpublished-packs` setup row and a held pull all name packs and the
 * remedy from here, so they never disagree.
 */

/** Never pushed: the engine pushes `origin HEAD` and nothing else. */
export const JANITOR_REF_PREFIX = "refs/mattstack/janitor/";

/** Pack zones are folders, stored with a trailing slash. */
export function janitorRefFor(zone: string): string {
  return `${JANITOR_REF_PREFIX}${zone.replace(/\/+$/, "")}`;
}

export function zoneOfJanitorRef(ref: string): string | null {
  if (!ref.startsWith(JANITOR_REF_PREFIX) || ref.length === JANITOR_REF_PREFIX.length) return null;
  return `${ref.slice(JANITOR_REF_PREFIX.length)}/`;
}

const TEAM_PACK_ZONE = /^mattstack\/teams\/([^/]+)\/plugin\/$/;

/** A team's pack zone is that one pack; a folder of packs (the org's base packs, the legacy packs folder) names each pack folder that holds one of `paths`. */
export function packsInZone(zone: string, paths: readonly string[]): string[] {
  const inZone = paths.filter((path) => path.startsWith(zone));
  const team = TEAM_PACK_ZONE.exec(zone)?.[1];
  if (team !== undefined) return inZone.length > 0 ? [team] : [];
  const names = inZone.map((path) => path.slice(zone.length).split("/")).filter((parts) => parts.length > 1 && parts[0] !== "").map((parts) => parts[0]!);
  return [...new Set(names)].sort();
}

export function publishPackCommand(pack: string): string {
  return `rt skills sync --pack ${pack} --commit-pending`;
}

export function discardPackCommand(pack: string): string {
  return `rt skills discard --pack ${pack}`;
}

export function packPhrase(packs: readonly string[]): string {
  if (packs.length === 1) return `the ${packs[0]} pack`;
  return `the ${packs.slice(0, -1).join(", ")} and ${packs.at(-1)} packs`;
}

function remedySentence(packs: readonly string[]): string {
  return packs.length === 1
    ? `Publish them with ${publishPackCommand(packs[0]!)}, or throw them away with ${discardPackCommand(packs[0]!)}.`
    : `Publish each with ${publishPackCommand("<pack>")}, or throw them away with ${discardPackCommand("<pack>")}.`;
}

/** Why a pull stopped, when what stopped it is a pack's unpublished edits. */
export function pullBlockedSentence(packs: readonly string[]): string {
  return `Unpublished changes to ${packPhrase(packs)} are holding back the pull from the org. ${remedySentence(packs)}`;
}

/** The steps a person runs for each pack, publish first. */
export function packRemedySteps(packs: readonly string[]): string[] {
  return packs.flatMap((pack) => [`Publish them: ${publishPackCommand(pack)}`, `Or throw them away: ${discardPackCommand(pack)}`]);
}

/** "7 hours ago", from the time a zone was first seen dirty. */
export function agoPhrase(sinceMs: number, nowMs: number): string {
  const hours = Math.floor(Math.max(0, nowMs - sinceMs) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
