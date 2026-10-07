/**
 * A team's pack is the team's Claude plugin: the one folder under
 * mattstack/teams/<team>/ a member's Mac installs. Everything that spells
 * the pack's place in the org repo reads it from here; the pre-move path
 * is spelled here only for the detector, and in the conversion planner.
 */
import { basename, dirname, join } from "path";
import { UserActionableError } from "../errors.ts";

export const TEAM_PACK_FOLDER = "plugin";

export function teamPackRel(team: string): string {
  return `mattstack/teams/${team}/${TEAM_PACK_FOLDER}`;
}

export function teamPackSource(team: string): string {
  return `./${teamPackRel(team)}`;
}

/** The team a pack folder belongs to when it sits at mattstack/teams/<team>/plugin, else null. */
export function teamOfPackDir(packDir: string): string | null {
  if (basename(packDir) !== TEAM_PACK_FOLDER) return null;
  const teamFolder = dirname(packDir);
  const teamsDir = dirname(teamFolder);
  if (basename(teamsDir) !== "teams" || basename(dirname(teamsDir)) !== "mattstack") return null;
  return basename(teamFolder) || null;
}

export function nestedTeamPackRel(team: string): string {
  return `mattstack/teams/${team}/packs/${team}`;
}

export function isUnconvertedTeamPack(fs: { exists(path: string): boolean }, teamFolder: string, team: string): boolean {
  const nested = join(teamFolder, "packs", team, "pack", "skills.jsonc");
  const moved = join(teamFolder, TEAM_PACK_FOLDER, "pack", "skills.jsonc");
  return fs.exists(nested) && !fs.exists(moved);
}

export function unconvertedTeamPackError(orgDir: string, team: string): UserActionableError {
  return new UserActionableError(
    "team-pack-unconverted",
    `Your org repo still keeps the ${team} pack at ${nestedTeamPackRel(team)}`,
    {},
    {
      why: `rt reads a team's pack from ${teamPackRel(team)} now`,
      next: `bun scripts/move-team-packs-to-plugin.ts ${orgDir} --admin <username> --write`,
      thenRun: "rt setup update",
    },
  );
}

/** The failure as one sentence, for a `detail` or `error` field that cannot carry next and thenRun apart. */
export function remedySentence(err: UserActionableError): string {
  if (!err.next) return err.message;
  return `${err.message}. Run ${err.next}${err.thenRun ? `, then ${err.thenRun}` : ""}`;
}
