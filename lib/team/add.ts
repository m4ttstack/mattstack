import { dirname, join } from "path";
import { assertTeamName } from "./team-names.ts";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { addMarketplacePlugin, packDescription, renderPackFiles } from "../skills/init.ts";
import { assertMayWrite, rolesFor, storedOrgValue } from "./roles.ts";
import { orgDirUnder } from "../rt-paths.ts";
import { TEAM_PACK_FOLDER, teamPackSource } from "./team-pack-path.ts";

export interface AddTeamOpts {
  org: string;
  team: string;
  owners: string[];
}

export interface AddTeamSeams {
  writeOrgSetting: (key: string, value: unknown) => void;
  engineDescription: (engine: string) => string | null;
}

export interface AddTeamResult {
  org: string;
  team: string;
  dir: string;
  owners: string[];
  wrote: string[];
}

const SETTINGS_HEADER = "// mattstack team settings. Created by `rt team add`. JSONC: comments and trailing commas are fine.\n";

function withTeam(p: Probes, org: string, team: string, owners: string[]): Record<string, unknown> {
  const stored = storedOrgValue(p, org);
  if (stored === null) {
    const roles = rolesFor(p, org);
    return { admins: roles.admins, teams: { ...roles.teams, [team]: { owners } } };
  }
  const teams = stored.teams !== null && typeof stored.teams === "object" && !Array.isArray(stored.teams) ? stored.teams : {};
  return { ...stored, teams: { ...teams, [team]: { owners } } };
}

export function addTeam(p: Probes, opts: AddTeamOpts, seams: AddTeamSeams): AddTeamResult {
  const { org, team, owners } = opts;
  assertMayWrite(p, org, ".claude-plugin/marketplace.json");
  assertTeamName(team);
  if (owners.length === 0) throw new UserActionableError("team-needs-owner", "A team needs at least one owner", {}, { next: `rt team add ${team} --owner <username>` });

  const root = orgDirUnder(p.home, org);
  const dir = join(root, "mattstack", "teams", team);
  if (p.exists(dir)) throw new UserActionableError("team-folder-exists", `The ${team} team already exists`);
  const workDescription = seams.engineDescription("work");
  if (workDescription === null) {
    throw new UserActionableError("mattstack-missing", "The mattstack plugin is not installed, so rt cannot write the team's pack", {}, { next: "rt setup pack" });
  }

  const marketPath = join(root, ".claude-plugin", "marketplace.json");
  const marketText = p.readFile(marketPath);
  if (marketText === null && p.exists(marketPath)) {
    throw new UserActionableError("team-marketplace-unreadable", "rt could not read your org's marketplace", {}, {
      why: "Check that you can read it, then try again.",
    });
  }
  const marketBefore = marketText ?? `${JSON.stringify({ name: org, owner: { name: org }, plugins: [] }, null, 2)}\n`;
  let marketAfter: string;
  const source = teamPackSource(team);
  try {
    const market = JSON.parse(marketBefore) as { plugins?: { name?: string; source?: unknown }[] };
    if (market.plugins?.some((entry) => entry.name === team && entry.source !== source)) {
      throw new UserActionableError("team-marketplace-conflict", `Your org's marketplace points ${team} at another pack`, {}, {
        why: "Ask an org admin to correct its source, then try again.",
      });
    }
    marketAfter = addMarketplacePlugin(marketBefore, team, packDescription(team), source);
  } catch (err) {
    if (err instanceof UserActionableError) throw err;
    throw new UserActionableError("team-marketplace-invalid", "rt could not read your org's marketplace", {}, {
      why: "Fix its JSON, then try again.",
      log: err instanceof Error ? err.message : String(err),
    });
  }
  const packFiles = renderPackFiles({ pack: team, workDescription });
  const wrote: string[] = [];
  const write = (path: string, text: string) => {
    assertMayWrite(p, org, ".claude-plugin/marketplace.json");
    p.mkdirp(dirname(path));
    assertMayWrite(p, org, ".claude-plugin/marketplace.json");
    p.writeFile(path, text);
    wrote.push(path);
  };

  write(join(dir, "settings.team.jsonc"), `${SETTINGS_HEADER}${JSON.stringify({ "board.title": team }, null, 2)}\n`);
  const packDir = join(dir, TEAM_PACK_FOLDER);
  for (const [rel, text] of Object.entries(packFiles)) write(join(packDir, rel), text);
  write(marketPath, marketAfter);

  assertMayWrite(p, org, ".claude-plugin/marketplace.json");
  seams.writeOrgSetting("mattstack.org", withTeam(p, org, team, owners));

  return { org, team, dir, owners, wrote };
}
