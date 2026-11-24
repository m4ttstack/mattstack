/** The org's support settings, and what they make of this Mac. */
import { normalizeRemote } from "../../packages/rt-client/src/settings/identity-codec.ts";
import { readOrgRoster } from "../../packages/rt-client/src/settings/active-team.ts";
import { getSetting } from "../settings/resolve.ts";
import { currentOrg } from "../settings/stores.ts";
import { createRealProbes, type Probes } from "../setup/probes.ts";
import { canonicalHandle } from "../team/board-peers.ts";
import { teamRemote } from "../team/members.ts";
import { readTeamLocal } from "../team/team-local.ts";

export interface SupportConfig {
  org: string;
  /** The path of the org clone's remote (`acme/mattstack`): what a message's proof names the org by. */
  orgPath: string;
  enabled: boolean;
  /** Null when no one is named, or the one named is not on the roster. */
  host: string | null;
  me: string | null;
  isHost: boolean;
  /** This Mac's own switch, whatever the org says now. */
  accepts: boolean;
  /** The switch counts: the org has support on and this person is its host. */
  acceptHere: boolean;
  roster: { username: string; name?: string }[];
}

/** Null on a Mac with no org, or an org with no remote, which no one else can share. */
export function supportConfig(p: Probes = createRealProbes()): SupportConfig | null {
  const org = currentOrg();
  if (org === null) return null;
  const remote = teamRemote(p, org);
  const orgPath = remote === null ? null : remotePath(remote);
  if (orgPath === null) return null;

  const roster = readOrgRoster(org).map((e) => ({ username: e.username, ...(typeof e.name === "string" ? { name: e.name } : {}) }));
  const enabled = getSetting<boolean>("support.enabled").value === true;
  const named = getSetting<string>("support.host").value ?? null;
  const host = named !== null && listed(roster, named) ? named : null;
  const me = readTeamLocal(p, org).forgeUsername ?? null;
  const isHost = host !== null && me !== null && canonicalHandle(host) === canonicalHandle(me);
  const accepts = getSetting<boolean>("support.acceptRequests").value === true;
  return { org, orgPath, enabled, host, me, isHost, accepts, acceptHere: enabled && isHost && accepts, roster };
}

/** Two Macs reach one org through an ssh alias, port 443 or https, so the host is left out: the org's own key is what tells two orgs apart. */
function remotePath(remote: string): string | null {
  const normalized = normalizeRemote(remote);
  if (normalized === null) return null;
  return normalized.slice(normalized.indexOf("/") + 1).replace(/\.git$/, "").toLowerCase();
}

function listed(roster: SupportConfig["roster"], username: string): boolean {
  return roster.some((e) => canonicalHandle(e.username) === canonicalHandle(username));
}

export function onRoster(cfg: Pick<SupportConfig, "roster">, username: string): boolean {
  return listed(cfg.roster, username);
}
