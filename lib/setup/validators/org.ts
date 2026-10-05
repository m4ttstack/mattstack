import type { TeamSnapshotEntry } from "../../daemon/team-snapshots.ts";
import { ownedRoots } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { mayOfferTokenToHost } from "../../team/forge-token.ts";
import { readUserIntegrationOverrides, probeUserSettingsReader } from "../team-settings.ts";
import { activeTeamFor } from "../../team/active-team.ts";
import { roleFor, rolesFor } from "../../team/roles.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { tokenCreateLink, tokenField, type ForgeProvider, type ForgeRole } from "../token-create.ts";

const FORGE_NAME: Record<ForgeProvider, string> = { github: "GitHub", gitlab: "GitLab" };

export function isPushRefusal(stderr: string): boolean {
  const message = stderr.replace(/https?:\/\/[^\s'"<>]+/gi, "");
  return /(?:\berror:\s*403\b|\bHTTP(?:\/\d(?:\.\d)?)?\s+403\b|\breturned error:\s*403\b|permission to [^\n]* denied|not allowed to push|protected branch[^\n]*(?:failed|declined|denied)|\bauthentication failed\b|\baccess denied\b|\binsufficient permissions?\b|write access to repository not granted|\bGH013:\s*Repository rule violations)/i.test(message);
}

function connect(p: Probes, forge: { provider: ForgeProvider; host: string }, role: ForgeRole): Action {
  const confirmedHost = readUserIntegrationOverrides({ read: probeUserSettingsReader(p) }).forgeHost;
  const create = mayOfferTokenToHost(forge.host, confirmedHost) ? tokenCreateLink(forge.provider, role, forge.host) : undefined;
  return { type: "connect", label: "Connect", integration: forge.provider, fields: [tokenField(forge.provider, role)], ...(create ? { create } : {}) };
}

function steps(lines: string[]): Action {
  return { type: "steps", label: "Show steps…", steps: lines };
}

function adminsNote(admins: string[]): string {
  return admins.length > 0 ? `an org admin (${admins.join(", ")})` : "an org admin";
}

export async function orgRows(
  p: Probes,
  org: string,
  opts: { forge: { provider: ForgeProvider; host: string } | null; readStatus: () => Promise<TeamSnapshotEntry[] | null> },
): Promise<Row[]> {
  const active = activeTeamFor(p, org);
  const base = { kind: "access" as const, required: false, recheck: "on-activate" as const };
  if (active.username === null) {
    const where = opts.forge ? ` on ${FORGE_NAME[opts.forge.provider]}` : "";
    return [row({
      ...base,
      id: "team.identity",
      title: "Who you are",
      why: "Your team, and what you may change, come from your username on the org's forge.",
      status: "needs-you",
      detail: `rt can't tell who you are${where} yet, so it does not know your team and no team pack is available`,
      action: opts.forge ? connect(p, opts.forge, "member") : steps(["Run: rt setup apply --only team.identity", "Then run: rt setup status"]),
    })];
  }

  const rows: Row[] = [];
  const roles = rolesFor(p, org);
  const role = roleFor(p, org);
  if (active.reason === "no-team") {
    const who = active.username;
    rows.push(row({
      ...base,
      id: "team.none",
      title: "Your team",
      why: "Your team's settings and pack apply once the org puts you on a team.",
      status: "needs-you",
      detail: `No team lists ${who} yet, so you only get the org's shared settings and no team pack is available`,
      action: steps([
        `Ask ${adminsNote(roles.admins)} to put ${who} on a team: rt team members set ${who} --teams <team>`,
        `If ${who} is not your forge username, ask them to fix your name on the roster`,
        "Then run: rt team pull",
      ]),
    }));
  }

  if (ownedRoots(role).length > 0) {
    const entry = (await opts.readStatus())?.find((e) => e.slug === org);
    if (entry?.lastPushError != null && isPushRefusal(entry.lastPushError)) {
      const what = role.kind === "owner" ? `the ${role.teams.join(" and ")} team${role.teams.length === 1 ? "" : "s"}` : "the org";
      rows.push(row({
        ...base,
        id: "team.push-access",
        title: "Push access",
        why: "An org admin grants write access on the forge; rt never changes access on a repo it did not create.",
        status: "needs-you",
        detail: `Your changes to ${what} are saved on this Mac, but the org repo refused the push. Ask ${adminsNote(roles.admins)} for write access`,
        action: opts.forge ? connect(p, opts.forge, "owner") : steps([`Ask ${adminsNote(roles.admins)} for write access to the org repo`, "Then run: rt team publish"]),
      }));
    }
  }
  return rows;
}
