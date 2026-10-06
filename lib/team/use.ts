import type { ActiveTeam } from "../../packages/rt-client/src/settings/active-team.ts";
import { UserActionableError } from "../errors.ts";

export interface UseTeamSeams {
  activeTeam: () => ActiveTeam;
  writeUserSetting: (key: string, value: unknown) => void;
  installPack: () => Promise<{ ok: boolean; detail: string }>;
  setPackEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  marketplace: (org: string) => string;
  restartApp: (app: "board" | "boxscore") => Promise<boolean>;
}

export interface UseTeamResult {
  team: string;
  previous: string | null;
  pack: { installed: boolean; enabled: boolean; detail: string };
  disabled: string | null;
  restarted: string[];
}

export async function useTeam(team: string, seams: UseTeamSeams): Promise<UseTeamResult> {
  const before = seams.activeTeam();
  if (before.org === null) throw new UserActionableError("no-team", "This Mac has no org yet", {}, { next: "rt team join" });
  if (before.username === null) throw new UserActionableError("forge-login-unknown", "rt cannot tell who you are, so it cannot tell which teams you are on", {}, { why: "Connect your forge account in Setup, then try again." });
  if (!before.listedOn.includes(team)) throw new UserActionableError("not-on-team", `The roster does not list you on the ${team} team`, {}, { why: before.listedOn.length > 0 ? `You are on ${before.listedOn.join(", ")}. An org admin adds you to another.` : "An org admin adds you to a team." });

  seams.writeUserSetting("mattstack.activeTeam", team);
  const marketplace = seams.marketplace(before.org);
  const installed = await seams.installPack();
  const enabled = installed.ok ? await seams.setPackEnabled(`${team}@${marketplace}`, true) : false;
  let disabled: string | null = null;
  if (enabled && before.team !== null && before.team !== team) {
    const id = `${before.team}@${marketplace}`;
    if (await seams.setPackEnabled(id, false)) disabled = id;
  }
  const restarted: string[] = [];
  for (const app of ["board", "boxscore"] as const) if (await seams.restartApp(app)) restarted.push(app);
  return { team, previous: before.team, pack: { installed: installed.ok, enabled, detail: installed.detail }, disabled, restarted };
}
