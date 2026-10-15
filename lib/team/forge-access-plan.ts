/**
 * What forge access the org's roles call for, and how it differs from what
 * the forge has. Pure: no forge call, no file read.
 */

import { createHash } from "crypto";
import { sameUser, type OrgRoles, type RosterEntry } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../../packages/rt-client/src/settings/org-roles.ts";
import { LEVEL_RANK, type ForgeMember, type PushList } from "./forge-access.ts";
import { HANDLE_PATTERN } from "./invite.ts";

export interface WantedMember {
  username: string;
  level: "read" | "write";
}

export interface Wanted {
  members: WantedMember[];
  pushers: string[];
  /** Roster or role names that are not forge usernames, so they never reach a forge API path. */
  invalid: string[];
}

export function wantedAccess(roles: OrgRoles, roster: RosterEntry[]): Wanted {
  const names: string[] = [];
  const invalid: string[] = [];
  const add = (raw: string) => {
    const name = raw.trim();
    if (name === "" || names.some((n) => sameUser(n, name)) || invalid.includes(name)) return;
    if (HANDLE_PATTERN.test(name)) names.push(name);
    else invalid.push(name);
  };
  for (const entry of roster) add(entry.username);
  for (const name of [...roles.owners, ...roles.admins, ...Object.values(roles.teams).flatMap((team) => team.owners)]) add(name);
  const members = names
    .map((username): WantedMember => {
      const role = roleOf(username, roles);
      return { username, level: isOrgAdmin(role) || role.kind === "owner" ? "write" : "read" };
    })
    .sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
  return { members, pushers: members.filter((m) => m.level === "write").map((m) => m.username), invalid };
}

/**
 * Only ever adds repo access. rt never lowers an existing repo-wide level,
 * even a member's write, because the repo may hold application code that
 * person works on; repo access comes off only through `rt team members
 * remove`. Losing a role or leaving the roster shows up here as a push list
 * removal and nothing else.
 */
export interface AccessDiff {
  /** People below the level their role needs. */
  grant: WantedMember[];
  addPush: string[];
  removePush: string[];
  /** Invited and not yet accepted. Informational: nothing to do until they accept. */
  waiting: string[];
}

export function accessDiff(wanted: Wanted, members: ForgeMember[], pushList: PushList): AccessDiff {
  const find = (username: string) => members.find((m) => sameUser(m.username, username));
  const diff: AccessDiff = { grant: [], addPush: [], removePush: [], waiting: [] };
  for (const want of wanted.members) {
    const current = find(want.username);
    if (current?.pending) diff.waiting.push(want.username);
    else if (!current || LEVEL_RANK[current.level] < LEVEL_RANK[want.level]) diff.grant.push(want);
  }
  if (pushList.kind === "named") {
    diff.addPush = wanted.pushers.filter((u) => !pushList.users.some((n) => sameUser(n, u)));
    diff.removePush = pushList.users.filter((n) => !wanted.pushers.some((u) => sameUser(n, u)));
  } else if (pushList.kind === "unprotected") {
    diff.addPush = [...wanted.pushers];
  }
  return diff;
}

export function hasChanges(diff: AccessDiff): boolean {
  return diff.grant.length + diff.addPush.length + diff.removePush.length > 0;
}

export function fingerprintOf(wanted: Wanted, branch: string): string {
  const members = wanted.members.map((m) => `${m.username.toLowerCase()}:${m.level}`).sort();
  return createHash("sha256").update(JSON.stringify({ branch, members })).digest("hex");
}

export function diffLines(diff: AccessDiff, branch: string): string[] {
  return [
    ...diff.grant.map((g) => `Give ${g.username} ${g.level} access`),
    ...diff.addPush.map((u) => `Let ${u} push ${branch}`),
    ...diff.removePush.map((u) => `Stop ${u} pushing ${branch}`),
  ];
}

export function limitSentence(pushList: PushList, branch: string): string | null {
  if (pushList.kind !== "open" && pushList.kind !== "unavailable") return null;
  return `${pushList.why}. Anyone with write access can push ${branch}, and only rt limits what they change there.`;
}
