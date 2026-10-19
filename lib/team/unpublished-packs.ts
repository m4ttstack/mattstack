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

/**
 * `team` is a team's pack, which `rt skills sync` publishes. An org base pack
 * or a pack in the legacy folder has no marketplace entry, so sync refuses it
 * and it is published by a hand commit instead.
 */
export interface PackRef {
  name: string;
  team: boolean;
}

const TEAM_PACK_ZONE = /^mattstack\/teams\/([^/]+)\/plugin\/$/;

/** A team's pack zone is that one pack; a folder of packs (the org's base packs, the legacy packs folder) names each pack folder that holds one of `paths`. */
export function packsInZone(zone: string, paths: readonly string[]): PackRef[] {
  const inZone = paths.filter((path) => path.startsWith(zone));
  const team = TEAM_PACK_ZONE.exec(zone)?.[1];
  if (team !== undefined) return inZone.length > 0 ? [{ name: team, team: true }] : [];
  const names = inZone.map((path) => path.slice(zone.length).split("/")).filter((parts) => parts.length > 1 && parts[0] !== "").map((parts) => parts[0]!);
  return [...new Set(names)].sort().map((name) => ({ name, team: false }));
}

/** Sorted by name, one entry per name. */
export function uniquePacks(packs: readonly PackRef[]): PackRef[] {
  const byName = new Map(packs.map((pack) => [pack.name, pack]));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function publishPackCommand(pack: string): string {
  return `rt skills sync --pack ${pack} --commit-pending`;
}

export function discardPackCommand(pack: string): string {
  return `rt skills discard --pack ${pack}`;
}

export function packPhrase(packs: readonly PackRef[]): string {
  const names = packs.map((pack) => pack.name);
  if (names.length === 1) return `the ${names[0]} pack`;
  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)} packs`;
}

/** `rt skills sync` refuses while anything else in the clone is changed, so a second dirty pack blocks the first one's publish. */
const ONE_AT_A_TIME = "rt skills sync publishes a pack only while the rest of your copy of the org is unchanged, so publish or throw away one pack before the next.";

function remedyFor(pack: PackRef): string {
  return pack.team
    ? `publish it with ${publishPackCommand(pack.name)}, or throw it away with ${discardPackCommand(pack.name)}`
    : `commit it by hand in your copy of the org and rt pushes the commit, or throw it away with ${discardPackCommand(pack.name)}`;
}

function remedySentences(packs: readonly PackRef[]): string {
  const each = packs.map((pack) => `For ${packPhrase([pack])}, ${remedyFor(pack)}.`);
  return [...each, ...(packs.length > 1 ? [ONE_AT_A_TIME] : [])].join(" ");
}

/** Why a pull stopped, when what stopped it is a pack's unpublished edits. */
export function pullBlockedSentence(packs: readonly PackRef[]): string {
  return `Unpublished changes to ${packPhrase(packs)} are holding back the pull from the org. ${remedySentences(packs)}`;
}

/** The steps a person runs for each pack, publish first. */
export function packRemedySteps(packs: readonly PackRef[]): string[] {
  return [
    ...packs.flatMap((pack) => [
      pack.team ? `Publish ${pack.name}: ${publishPackCommand(pack.name)}` : `Publish ${pack.name}: commit its folder by hand in your copy of the org, and rt pushes the commit`,
      `Or throw away the ${pack.name} changes: ${discardPackCommand(pack.name)}`,
    ]),
    ...(packs.length > 1 ? [ONE_AT_A_TIME] : []),
  ];
}

/** "7 hours ago", from the time a zone was first seen dirty. */
export function agoPhrase(sinceMs: number, nowMs: number): string {
  const hours = Math.floor(Math.max(0, nowMs - sinceMs) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
