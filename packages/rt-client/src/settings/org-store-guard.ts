/**
 * Whether a change to the org store is this role's to make. The org store is
 * one file, so path ownership cannot express "a team owner changes only their
 * own team's membership"; this compares the two versions instead.
 */

import { isDeepStrictEqual } from "util";
import { rolesFrom, sameUser, type RosterEntry } from "./active-team.ts";
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

const OWNER_REFUSAL = "A team owner can only change which teams people are on in the org's settings.";
const ORDER_REFUSAL = "A team owner can add or remove their own team on someone's list, but not change its order: the first team is where that person starts.";
const ADD_REMOVE_REFUSAL = "A team owner can't add people to the org or remove them from it. An org admin does that.";

interface RawRoster {
  flat: unknown;
  nested: unknown;
}

function rawRoster(store: StoreFile): RawRoster {
  const nested = store.global.mattstack;
  const inner = nested !== null && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>).roster : undefined;
  return { flat: store.global[ROSTER], nested: inner };
}

function wellFormed(entries: unknown): entries is RosterEntry[] {
  return (
    Array.isArray(entries) &&
    entries.every((e) => {
      if (e === null || typeof e !== "object" || Array.isArray(e)) return false;
      const { username, teams } = e as { username?: unknown; teams?: unknown };
      return typeof username === "string" && (teams === undefined || (Array.isArray(teams) && teams.every((t) => typeof t === "string")));
    })
  );
}

function uniqueUsers(entries: RosterEntry[]): boolean {
  return entries.every((e, i) => entries.findIndex((o) => sameUser(o.username, e.username)) === i);
}

/** The old list minus some of the owner's teams, then some of the owner's teams not on it appended. */
function ownTeamsOnlyAddedOrRemoved(ownTeams: string[], was: string[], now: string[]): boolean {
  const kept = was.filter((t) => !ownTeams.includes(t) || now.includes(t));
  const appended = now.slice(kept.length);
  return (
    isDeepStrictEqual(now.slice(0, kept.length), kept) &&
    appended.every((t, i) => ownTeams.includes(t) && !was.includes(t) && appended.indexOf(t) === i)
  );
}

function rosterRefusal(ownTeams: string[], before: RawRoster, after: RawRoster): string | null {
  if (isDeepStrictEqual(before, after)) return null;
  const spelling = before.flat !== undefined ? "flat" : "nested";
  if ((before.flat !== undefined) === (before.nested !== undefined) || (after.flat !== undefined) === (after.nested !== undefined)) return OWNER_REFUSAL;
  if ((after.flat !== undefined ? "flat" : "nested") !== spelling) return OWNER_REFUSAL;
  const was = before[spelling];
  const now = after[spelling];
  if (!wellFormed(was) || !wellFormed(now) || !uniqueUsers(was) || !uniqueUsers(now)) return OWNER_REFUSAL;
  if (was.length !== now.length) return ADD_REMOVE_REFUSAL;
  for (const w of was) {
    const n = now.find((e) => sameUser(e.username, w.username));
    if (!n) return ADD_REMOVE_REFUSAL;
    const { teams: a, ...wRest } = w;
    const { teams: b, ...nRest } = n;
    if (!isDeepStrictEqual(wRest, nRest)) return `A team owner can only change which teams someone is on, not ${w.username}'s other details.`;
    // Ordered, not a set: the first team in the list is the one a member starts on.
    const others = (teams: string[] | undefined) => (teams ?? []).filter((t) => !ownTeams.includes(t));
    const [x, y] = [others(a), others(b)];
    if (!isDeepStrictEqual(x, y)) {
      const all = [...new Set([...x, ...y])];
      const moved = all.filter((t) => x.filter((u) => u === t).length !== y.filter((u) => u === t).length || x.indexOf(t) !== y.indexOf(t));
      const foreign = moved.length > 0 ? moved : all;
      return `You don't own ${foreign.join(" or ")}, so you can't change who is on it.`;
    }
    if (!ownTeamsOnlyAddedOrRemoved(ownTeams, a ?? [], b ?? [])) return ORDER_REFUSAL;
  }
  return null;
}

export function orgStoreChangeRefusal(role: OrgRole, before: StoreFile, after: StoreFile): string | null {
  if (role.kind === "org-owner") return null;
  // Plain admin test on purpose: isOrgAdmin would include org owners, who returned above.
  if (role.kind === "admin") {
    const changed = !isDeepStrictEqual([...rolesFrom(before).owners].sort(), [...rolesFrom(after).owners].sort());
    return changed ? "Only an org owner can change who the org owners are." : null;
  }
  if (role.kind !== "owner") return isDeepStrictEqual(before.global, after.global) && isDeepStrictEqual(before.repos, after.repos) ? null : "The org's shared settings belong to its admins.";
  if (!isDeepStrictEqual(withoutKeys(before, [ROSTER]), withoutKeys(after, [ROSTER]))) return OWNER_REFUSAL;
  return rosterRefusal(role.teams, rawRoster(before), rawRoster(after));
}
