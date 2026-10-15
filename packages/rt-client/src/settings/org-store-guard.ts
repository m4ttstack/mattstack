/**
 * Whether a change to the org store is this role's to make. The org store is
 * one file, so path ownership cannot express "a team owner changes only their
 * own team's membership"; this compares the two versions instead.
 */

import { isDeepStrictEqual } from "util";
import { rolesFrom, rosterFrom, sameUser, type RosterEntry } from "./active-team.ts";
import type { OrgRole } from "./org-roles.ts";
import type { StoreFile } from "./stores.ts";

const ROSTER = "mattstack.roster";

/** The store with the roster key removed, in both the flat and the nested spelling. */
function withoutKeys(store: StoreFile, keys: string[]): unknown {
  const global = structuredClone(store.global);
  for (const key of keys) {
    delete global[key];
    const [head, tail] = [key.slice(0, key.indexOf(".")), key.slice(key.indexOf(".") + 1)];
    const nested = global[head];
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) delete (nested as Record<string, unknown>)[tail];
  }
  return { global, repos: store.repos };
}

function teamsOf(entry: RosterEntry): Set<string> {
  return new Set(Array.isArray(entry.teams) ? entry.teams.filter((t): t is string => typeof t === "string") : []);
}

function rosterRefusal(ownTeams: string[], before: RosterEntry[], after: RosterEntry[]): string | null {
  if (before.length !== after.length) return "A team owner can't add people to the org or remove them from it. An org admin does that.";
  for (const was of before) {
    const now = after.find((e) => sameUser(e.username, was.username));
    if (!now) return "A team owner can't add people to the org or remove them from it. An org admin does that.";
    const { teams: _a, ...wasRest } = was;
    const { teams: _b, ...nowRest } = now;
    if (!isDeepStrictEqual({ ...wasRest, username: wasRest.username.toLowerCase() }, { ...nowRest, username: nowRest.username.toLowerCase() })) {
      return `A team owner can only change which teams someone is on, not ${was.username}'s other details.`;
    }
    const a = teamsOf(was);
    const b = teamsOf(now);
    const changed = [...a].filter((t) => !b.has(t)).concat([...b].filter((t) => !a.has(t)));
    const foreign = changed.filter((t) => !ownTeams.includes(t));
    if (foreign.length > 0) return `You don't own ${foreign.join(" or ")}, so you can't change who is on it.`;
  }
  return null;
}

export function orgStoreChangeRefusal(role: OrgRole, before: StoreFile, after: StoreFile): string | null {
  if (role.kind === "org-owner") return null;
  if (role.kind === "admin") {
    const changed = !isDeepStrictEqual([...rolesFrom(before).owners].sort(), [...rolesFrom(after).owners].sort());
    return changed ? "Only an org owner can change who the org owners are." : null;
  }
  if (!isDeepStrictEqual(withoutKeys(before, [ROSTER]), withoutKeys(after, [ROSTER]))) {
    return role.kind === "owner" ? "A team owner can only change which teams people are on in the org's settings." : "The org's shared settings belong to its admins.";
  }
  if (role.kind !== "owner") return isDeepStrictEqual(rosterFrom(before), rosterFrom(after)) ? null : "The org's shared settings belong to its admins.";
  return rosterRefusal(role.teams, rosterFrom(before), rosterFrom(after));
}
