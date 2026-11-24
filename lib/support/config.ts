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
  /** The org clone's remote as `host/path`: what a message's proof names the org by. */
  orgRemote: string;
  enabled: boolean;
  /** Null when no one is named, or the one named is not on the roster. */
  host: string | null;
  me: string | null;
  isHost: boolean;
  acceptHere: boolean;
  roster: { username: string; name?: string }[];
}

/** Null on a Mac with no org, or an org with no remote, which no one else can share. */
export function supportConfig(p: Probes = createRealProbes()): SupportConfig | null {
  const org = currentOrg();
  if (org === null) return null;
  const remote = teamRemote(p, org);
  const orgRemote = remote === null ? null : normalizeRemote(remote);
  if (orgRemote === null) return null;

  const roster = readOrgRoster(org).map((e) => ({ username: e.username, ...(typeof e.name === "string" ? { name: e.name } : {}) }));
  const enabled = getSetting<boolean>("support.enabled").value === true;
  const named = getSetting<string>("support.host").value ?? null;
  const host = named !== null && listed(roster, named) ? named : null;
  const me = readTeamLocal(p, org).forgeUsername ?? null;
  const isHost = host !== null && me !== null && canonicalHandle(host) === canonicalHandle(me);
  const acceptHere = enabled && isHost && getSetting<boolean>("support.acceptRequests").value === true;
  return { org, orgRemote, enabled, host, me, isHost, acceptHere, roster };
}

function listed(roster: SupportConfig["roster"], username: string): boolean {
  return roster.some((e) => canonicalHandle(e.username) === canonicalHandle(username));
}

export function onRoster(cfg: Pick<SupportConfig, "roster">, username: string): boolean {
  return listed(cfg.roster, username);
}
